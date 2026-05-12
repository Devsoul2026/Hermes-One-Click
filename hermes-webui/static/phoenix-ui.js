/**
 * Phoenix UI — Process Guardian Monitor for Hermes-One-Click
 *
 * Provides a status indicator pill (mounts into any container) and a
 * collapsible detail/event panel.  Listens to Tauri Events pushed by the
 * Rust backend and calls Tauri Invoke Commands for state & control.
 *
 * Usage:
 *   const ui = new PhoenixUI(document.getElementById('phoenix-mount'));
 *   ui.init();
 *   // later: ui.destroy();
 */
(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────────────── */
  var STATUS_CONFIG = {
    Running:    { cls:'running',  label:'Running',  color:'#22c55e' },
    Starting:   { cls:'starting', label:'Starting', color:'#eab308' },
    Stopping:   { cls:'stopping', label:'Stopping', color:'#6b7280' },
    Crashed:    { cls:'crashed',  label:'Crashed',  color:'#ef4444' },
    Unknown:    { cls:'unknown',  label:'Unknown',  color:'#d1d5db' },
    Disabled:   { cls:'disabled', label:'Disabled', color:'#3b82f6' }
  };

  var EVENT_ICONS = {
    'StatusChanged':        { icon:'\u25B6', cls:'ev-status-change' },
    'HealthCheckPassed':    { icon:'\u2713', cls:'ev-health-passed' },
    'HealthCheckFailed':    { icon:'\u2717', cls:'ev-health-failed' },
    'CrashDetected':        { icon:'\u26A0', cls:'ev-crash' },
    'RestartInitiated':     { icon:'\u21BB', cls:'ev-restart-init' },
    'RestartSuccess':       { icon:'\u2713', cls:'ev-restart-success' },
    'RestartFailed':        { icon:'\u2717', cls:'ev-restart-failed' }
  };

  var MAX_EVENTS = 100;

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  }

  function fmtTime(ts) {
    if (!ts) return '--:--:--';
    var d = new Date(ts);
    return ('0' + d.getHours()).slice(-2) + ':' +
           ('0' + d.getMinutes()).slice(-2) + ':' +
           ('0' + d.getSeconds()).slice(-2);
  }

  function fmtUptime(secs) {
    if (!secs || secs < 0) return '0s';
    var d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600);
    var m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60);
    var parts = [];
    if (d > 0) parts.push(d + 'd');
    if (h > 0) parts.push(h + 'h');
    if (m > 0) parts.push(m + 'm');
    parts.push(s + 's');
    return parts.join(' ');
  }

  /** Safe Tauri API access — returns null when not running inside Tauri. */
  function _tauri() {
    try {
      // @tauri-apps/api v2 shape
      if (window.__TAURI_INTERNALS__) {
        return {
          invoke: function (cmd, args) {
            return window.__TAURI_INTERNALS__.invoke(cmd, args);
          },
          listen: function (event, handler) {
            return window.__TAURI_INTERNALS__.listen(event, handler);
          },
          unlisten: function (id) {
            return window.__TAURI_INTERNALS__.unlisten(id);
          }
        };
      }
    } catch (_) {}
    return null;
  }

  /* ── PhoenixUI Class ───────────────────────────────────────────────────── */
  function PhoenixUI(container) {
    if (!(this instanceof PhoenixUI)) return new PhoenixUI(container);
    this._container = container || document.body;
    this._tauri = null;
    this._listeners = [];        // { id, event } for cleanup
    this._domRefs = {};         // cached DOM nodes
    this._uptimeTimer = null;
    this._uptimeBase = null;     // timestamp when uptime was last read
    this._uptimeSecs = 0;        // uptime snapshot in seconds
    this._events = [];
    this._panelOpen = false;
    this._detailOpen = true;
    this._eventsOpen = true;
    this._configOpen = false;
    this._currentStatus = 'Unknown';
    this._destroyed = false;
  }

  /* ---- init -------------------------------------------------------------- */
  PhoenixUI.prototype.init = function () {
    var self = this;
    if (self._destroyed) return;

    self._tauri = _tauri();

    // Build DOM
    self._buildIndicator();
    self._buildPanel();
    self._injectStyles();

    // Bind indicator click -> toggle panel
    self._domRefs.pill.addEventListener('click', function (e) {
      e.stopPropagation();
      self._togglePanel();
    });

    // Close panel on outside click
    document.addEventListener('click', self._onOutsideClick = function (e) {
      if (self._panelOpen && !self._panel.contains(e.target) && !self._domRefs.pill.contains(e.target)) {
        self._closePanel();
      }
    });

    // Wire section toggles
    self._bindSectionToggle('detail');
    self._bindSectionToggle('events');
    self._bindSectionToggle('config');

    // Wire controls
    self._wireControls();

    // Fetch initial state
    self._fetchInitialStatus();

    // Listen to Tauri events -- backend emits all PhoenixEvent variants
    // through a single "phoenix:event" channel (externally-tagged serde enum).
    if (self._tauri) {
      self._listenEvent('phoenix:event', function (payload) {
        if (!payload || typeof payload !== 'object') return;
        // The payload is { "VariantName": { ...fields } } -- extract variant + data.
        var variant = Object.keys(payload)[0];
        var data = payload[variant];
        switch (variant) {
          case 'StatusChanged':
            self._handleStatusChanged(data); break;
          case 'HealthCheckPassed':
            self._handleHealthCheckPassed(data && data.result); break;
          case 'HealthCheckFailed':
            self._handleHealthCheckFailed(data && data.result); break;
          case 'CrashDetected':
            self._handleCrashDetected(data); break;
          case 'RestartInitiated':
            self._handleRestartInitiated(data); break;
          case 'RestartSuccess':
            self._handleRestartSuccess(data); break;
          case 'RestartFailed':
            self._handleRestartFailed(data); break;
          default:
            console.warn('[Phoenix] Unknown event variant:', variant);
        }
      });
    } else {
      // Dev / non-Tauri fallback: show placeholder
      console.warn('[Phoenix] Not running inside Tauri — using mock data.');
      self._applyMockData();
    }
  };

  /* ---- destroy ----------------------------------------------------------- */
  PhoenixUI.prototype.destroy = function () {
    var self = this;
    self._destroyed = true;

    // Stop uptime timer
    self._stopUptimeTimer();

    // Unlisten all Tauri events
    self._listeners.forEach(function (l) {
      try { if (self._tauri) self._tauri.unlisten(l.id); } catch (_) {}
    });
    self._listeners = [];

    // Remove outside-click listener
    if (self._onOutsideClick) {
      document.removeEventListener('click', self._onOutsideClick);
    }

    // Remove DOM
    if (self._domRefs.pill && self._domRefs.pill.parentNode) {
      self._domRefs.pill.parentNode.removeChild(self._domRefs.pill);
    }
    if (self._panel && self._panel.parentNode) {
      self._panel.parentNode.removeChild(self._panel);
    }
    if (self._styleEl && self._styleEl.parentNode) {
      self._styleEl.parentNode.removeChild(self._styleEl);
    }

    self._domRefs = {};
    self._panel = null;
  };

  /* ── DOM Construction ──────────────────────────────────────────────────── */

  /** Small status pill that mounts inside the user-supplied container. */
  PhoenixUI.prototype._buildIndicator = function () {
    var self = this;
    var pill = document.createElement('div');
    pill.className = 'phoenix-pill';
    pill.setAttribute('tabindex', '0');
    pill.setAttribute('role', 'button');
    pill.setAttribute('aria-label', 'Phoenix process guardian — click for details');
    pill.innerHTML =
      '<span class="phoenix-dot unknown" id="phxDot"></span>' +
      '<span id="phxPillLabel">Phoenix</span>';

    self._container.appendChild(pill);
    self._domRefs.pill = pill;
    self._domRefs.dot = pill.querySelector('#phxDot');
    self._domRefs.pillLabel = pill.querySelector('#phxPillLabel');
  };

  /** The collapsible floating panel with details, config, and event log. */
  PhoenixUI.prototype._buildPanel = function () {
    var self = this;
    var panel = document.createElement('div');
    panel.className = 'phoenix-panel phx-collapsed';
    panel.innerHTML = [
      '  <div class="phoenix-panel-head">',
      '    <div class="phoenix-panel-title">',
      '      <svg class="phoenix-panel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
      '      Phoenix Guardian',
      '      <span class="phoenix-panel-status-badge" id="phxPanelBadge">Unknown</span>',
      '    </div>',
      '    <button class="phoenix-panel-close" type="button" aria-label="Close panel" id="phxPanelClose">&times;</button>',
      '  </div>',
      '',
      '  <!-- Stats Row -->',
      '  <div class="phoenix-stats-row" id="phxStatsRow">',
      '    <div class="phoenix-stat"><div class="phoenix-stat-value" id="phxStatUptime">--</div><div class="phoenix-stat-label">Uptime</div></div>',
      '    <div class="phoenix-stat"><div class="phoenix-stat-value" id="phxStatCrashes">0</div><div class="phoenix-stat-label">Crashes</div></div>',
      '    <div class="phoenix-stat"><div class="phoenix-stat-value" id="phxStatRate">--</div><div class="phoenix-stat-label">Success %</div></div>',
      '  </div>',
      '',
      '  <!-- Detail Section -->',
      '  <div class="phoenix-section" id="phxSecDetail">',
      '    <div class="phoenix-section-header open" id="phxDetailHead">',
      '      <span class="phoenix-section-title">Details</span>',
      '      <svg class="phoenix-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
      '    </div>',
      '    <div class="phoenix-section-body open" id="phxDetailBody">',
      '      <div class="phoenix-detail-grid" id="phxDetailGrid">',
      '        <span class="phoenix-detail-label">Status</span><span class="phoenix-detail-value" id="phxDSStatus">--</span>',
      '        <span class="phoenix-detail-label">Uptime</span><span class="phoenix-detail-value phoenix-uptime" id="phxDSUptime">--</span>',
      '        <span class="phoenix-detail-label">Crashes</span><span class="phoenix-detail-value" id="phxDSCrashes">0</span>',
      '        <span class="phoenix-detail-label">Consecutive Failures</span><span class="phoenix-detail-value" id="phxDSFails">0</span>',
      '        <span class="phoenix-detail-label">Last Health Check</span><span class="phoenix-detail-value" id="phxDSHealth">--</span>',
      '        <span class="phoenix-detail-label">Enabled</span><span class="phoenix-detail-value" id="phxDSEnabled">Yes</span>',
      '      </div>',
      '      <div class="phoenix-controls" id="phxControls">',
      '        <button class="phoenix-btn danger" type="button" id="phxBtnRestart" title="Manually restart the guarded process">',
      '          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Restart',
      '        </button>',
      '        <div class="phoenix-toggle-wrap">',
      '          <input type="checkbox" class="phoenix-toggle" id="phxToggleEnabled" checked>',
      '          <label for="phxToggleEnabled">Enabled</label>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- Config Section -->',
      '  <div class="phoenix-section" id="phxSecConfig">',
      '    <div class="phoenix-section-header" id="phxConfigHead">',
      '      <span class="phoenix-section-title">Configuration</span>',
      '      <svg class="phoenix-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
      '    </div>',
      '    <div class="phoenix-section-body" id="phxConfigBody">',
      '      <div class="phoenix-config-grid" id="phxConfigGrid">',
      '        <div class="phoenix-config-field">',
      '          <label class="phoenix-config-label">Check Interval (s)</label>',
      '          <input type="number" class="phoenix-config-input" id="phxCfgInterval" min="1" max="3600" value="30">',
      '        </div>',
      '        <div class="phoenix-config-field">',
      '          <label class="phoenix-config-label">Health Timeout (s)</label>',
      '          <input type="number" class="phoenix-config-input" id="phxCfgTimeout" min="1" max="300" value="10">',
      '        </div>',
      '        <div class="phoenix-config-field">',
      '          <label class="phoenix-config-label">Max Restart Attempts</label>',
      '          <input type="number" class="phoenix-config-input" id="phxCfgMaxRestarts" min="0" max="100" value="5">',
      '        </div>',
      '        <div class="phoenix-config-field">',
      '          <label class="phoenix-config-label">Backoff Base (s)</label>',
      '          <input type="number" class="phoenix-config-input" id="phxCfgBackoffBase" min="1" max="300" value="2">',
      '        </div>',
      '        <div class="phoenix-config-field full-width">',
      '          <label class="phoenix-config-label">Backoff Cap (s)</label>',
      '          <input type="number" class="phoenix-config-input" id="phxCfgBackoffCap" min="1" max="3600" value="60">',
      '        </div>',
      '      </div>',
      '      <div class="phoenix-config-actions">',
      '        <button class="phoenix-btn primary" type="button" id="phxBtnSaveCfg">Save Config</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- Event Log Section -->',
      '  <div class="phoenix-section" id="phxSecEvents">',
      '    <div class="phoenix-section-header open" id="phxEventsHead">',
      '      <span class="phoenix-section-title">Event Log</span>',
      '      <svg class="phoenix-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
      '    </div>',
      '    <div class="phoenix-section-body open" id="phxEventsBody">',
      '      <div class="phoenix-events-list" id="phxEventsList">',
      '        <div class="phoenix-events-empty">No events yet.</div>',
      '      </div>',
      '      <div class="phoenix-events-toolbar">',
      '        <span class="phoenix-events-count" id="phxEventsCount">0 events</span>',
      '        <button class="phoenix-events-clear" type="button" id="phxBtnClearEvents">Clear</button>',
      '      </div>',
      '    </div>',
      '  </div>'
    ].join('\n');

    document.body.appendChild(panel);
    self._panel = panel;

    // Cache refs
    var $ = function (id) { return panel.querySelector('#' + id); };
    self._domRefs.panelBadge    = $('phxPanelBadge');
    self._domRefs.panelClose    = $('phxPanelClose');
    self._domRefs.statUptime    = $('phxStatUptime');
    self._domRefs.statCrashes   = $('phxStatCrashes');
    self._domRefs.statRate      = $('phxStatRate');
    self._domRefs.dsStatus      = $('phxDSStatus');
    self._domRefs.dsUptime      = $('phxDSUptime');
    self._domRefs.dsCrashes     = $('phxDSCrashes');
    self._domRefs.dsFails       = $('phxDSFails');
    self._domRefs.dsHealth      = $('phxDSHealth');
    self._domRefs.dsEnabled     = $('phxDSEnabled');
    self._domRefs.btnRestart    = $('phxBtnRestart');
    self._domRefs.toggleEnabled = $('phxToggleEnabled');
    self._domRefs.eventsList    = $('phxEventsList');
    self._domRefs.eventsCount   = $('phxEventsCount');
    self._domRefs.btnClearEvts  = $('phxBtnClearEvents');
    self._domRefs.btnSaveCfg    = $('phxBtnSaveCfg');
    self._domRefs.detailHead    = $('phxDetailHead');
    self._domRefs.detailBody    = $('phxDetailBody');
    self._domRefs.configHead    = $('phxConfigHead');
    self._domRefs.configBody    = $('phxConfigBody');
    self._domRefs.eventsHead    = $('phxEventsHead');
    self._domRefs.eventsBody    = $('phxEventsBody');
  };

  /** Inject link tag for phoenix-ui.css if not already present. */
  PhoenixUI.prototype._injectStyles = function () {
    var existing = document.querySelector('link[data-phoenix-style]');
    if (existing) { this._styleEl = existing; return; }
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'static/phoenix-ui.css?v=' + (Date.now());
    link.setAttribute('data-phoenix-style', '1');
    document.head.appendChild(link);
    this._styleEl = link;
  };

  /* ── Panel Toggle --------------------------------------------------------- */
  PhoenixUI.prototype._togglePanel = function () {
    if (this._panelOpen) this._closePanel(); else this._openPanel();
  };

  PhoenixUI.prototype._openPanel = function () {
    this._panelOpen = true;
    this._panel.classList.remove('phx-collapsed');
  };

  PhoenixUI.prototype._closePanel = function () {
    this._panelOpen = false;
    this._panel.classList.add('phx-collapsed');
  };

  /* ── Section Toggles ------------------------------------------------------ */
  PhoenixUI.prototype._bindSectionToggle = function (name) {
    var self = this;
    var head = self._domRefs[name + 'Head'];
    var body = self._domRefs[name + 'Body'];
    if (!head || !body) return;
    head.addEventListener('click', function () {
      var isOpen = head.classList.contains('open');
      head.classList.toggle('open');
      body.classList.toggle('open');
      if (name === 'detail') self._detailOpen = !isOpen;
      if (name === 'events') self._eventsOpen = !isOpen;
      if (name === 'config') self._configOpen = !isOpen;
    });
  };

  /* ── Control Wiring ------------------------------------------------------- */
  PhoenixUI.prototype._wireControls = function () {
    var self = this;

    // Panel close button
    self._domRefs.panelClose.addEventListener('click', function (e) {
      e.stopPropagation();
      self._closePanel();
    });

    // Manual restart
    self._domRefs.btnRestart.addEventListener('click', function () {
      self._handleManualRestart();
    });

    // Enable/Disable toggle
    self._domRefs.toggleEnabled.addEventListener('change', function () {
      self._toggleEnabled(this.checked);
    });

    // Clear events
    self._domRefs.btnClearEvts.addEventListener('click', function () {
      self._clearEvents();
    });

    // Save config
    self._domRefs.btnSaveCfg.addEventListener('click', function () {
      self._saveConfig();
    });
  };

  /* ── Status Indicator Update --------------------------------------------- */
  PhoenixUI.prototype._updateStatusIndicator = function (status) {
    var self = this;
    self._currentStatus = status;
    var cfg = STATUS_CONFIG[status] || STATUS_CONFIG['Unknown'];

    // Update dot
    var dot = self._domRefs.dot;
    dot.className = 'phoenix-dot ' + cfg.cls;

    // Update pill label
    self._domRefs.pillLabel.textContent = cfg.label;
    self._domRefs.pill.setAttribute('aria-label',
      'Phoenix Guardian — ' + cfg.label + '. Click for details.');

    // Update panel badge
    if (self._domRefs.panelBadge) {
      self._domRefs.panelBadge.textContent = cfg.label;
      self._domRefs.panelBadge.className = 'phoenix-panel-status-badge status-' + cfg.cls;
    }

    // Update detail grid status cell
    if (self._domRefs.dsStatus) {
      self._domRefs.dsStatus.textContent = cfg.label;
      self._domRefs.dsStatus.className = 'phoenix-detail-value status-' + cfg.cls;
    }
  };

  /* ── Detail Panel Update -------------------------------------------------- */
  PhoenixUI.prototype._updateDetailPanel = function (snapshot) {
    var self = this;
    if (!snapshot) return;

    // Status
    self._updateStatusIndicator(snapshot.status || 'Unknown');

    // Uptime
    self._uptimeSecs = snapshot.uptime_secs || 0;
    self._uptimeBase = Date.now();
    self._renderUptime();
    self._startUptimeTimer();

    // Crashes
    if (self._domRefs.dsCrashes) {
      var cc = snapshot.crash_count || 0;
      self._domRefs.dsCrashes.textContent = String(cc);
      self._domRefs.dsCrashes.className = 'phoenix-detail-value' + (cc > 0 ? ' warning' : '');
    }
    if (self._domRefs.statCrashes) {
      self._domRefs.statCrashes.textContent = String(snapshot.crash_count || 0);
    }

    // Consecutive failures
    if (self._domRefs.dsFails) {
      var cf = snapshot.consecutive_failures || 0;
      self._domRefs.dsFails.textContent = String(cf);
      self._domRefs.dsFails.className = 'phoenix-detail-value' + (cf > 0 ? ' error' : '');
    }

    // Last health check
    if (self._domRefs.dsHealth) {
      self._domRefs.dsHealth.textContent = snapshot.last_health_check
        ? new Date(snapshot.last_health_check).toLocaleString() : '--';
    }

    // Enabled
    if (self._domRefs.dsEnabled) {
      var en = snapshot.enabled !== false;
      self._domRefs.dsEnabled.textContent = en ? 'Yes' : 'No';
      self._domRefs.dsEnabled.className = 'phoenix-detail-value' + (en ? ' success' : '');
    }
    if (self._domRefs.toggleEnabled) {
      self._domRefs.toggleEnabled.checked = en;
    }

    // Populate config fields
    if (snapshot.config) {
      var c = snapshot.config;
      var v = function (id, key, def) {
        var el = self._domRefs[id];
        if (el && c[key] != null) el.value = c[key];
        else if (el) el.value = def;
      };
      v('phxCfgInterval',    'check_interval_secs',   '30');
      v('phxCfgTimeout',     'health_timeout_secs',   '10');
      v('phxCfgMaxRestarts', 'max_restart_attempts',  '5');
      v('phxCfgBackoffBase', 'backoff_base_secs',     '2');
      v('phxCfgBackoffCap',  'backoff_cap_secs',      '60');
    }
  };

  /* ── Stats Update --------------------------------------------------------- */
  PhoenixUI.prototype._updateStats = function (stats) {
    if (!stats) return;
    if (this._domRefs.statUptime)
      this._domRefs.statUptime.textContent = fmtUptime(stats.total_uptime_secs || 0);
    if (this._domRefs.statCrashes)
      this._domRefs.statCrashes.textContent = String(stats.total_crashes || 0);
    if (this._domRefs.statRate) {
      var rate = stats.restart_success_rate != null
        ? (stats.restart_success_rate * 100).toFixed(0) + '%' : '--';
      this._domRefs.statRate.textContent = rate;
    }
  };

  /* ── Uptime Timer ---------------------------------------------------------- */
  PhoenixUI.prototype._startUptimeTimer = function () {
    var self = this;
    self._stopUptimeTimer();
    if (self._currentStatus !== 'Running') return;
    self._uptimeTimer = setInterval(() => {
      self._renderUptime();
    }, 1000);
  };

  PhoenixUI.prototype._stopUptimeTimer = function () {
    if (this._uptimeTimer) {
      clearInterval(this._uptimeTimer);
      this._uptimeTimer = null;
    }
  };

  PhoenixUI.prototype._renderUptime = function () {
    var self = this;
    var elapsed;
    if (self._currentStatus === 'Running' && self._uptimeBase) {
      elapsed = self._uptimeSecs + Math.floor((Date.now() - self._uptimeBase) / 1000);
    } else {
      elapsed = self._uptimeSecs;
    }
    var text = fmtUptime(elapsed);
    if (self._domRefs.dsUptime) self._domRefs.dsUptime.textContent = text;
    if (self._domRefs.statUptime) self._domRefs.statUptime.textContent = text;
  };

  /* ── Event Log ------------------------------------------------------------ */
  PhoenixUI.prototype._appendEvent = function (event) {
    var self = this;
    var now = event.timestamp || Date.now();

    var entry = {
      ts: now,
      type: event.type || 'info',
      icon: event.icon || '\u2022',
      iconCls: event.iconCls || 'ev-info',
      desc: event.desc || ''
    };

    self._events.unshift(entry);

    // Trim to MAX_EVENTS
    if (self._events.length > MAX_EVENTS) {
      self._events = self._events.slice(0, MAX_EVENTS);
    }

    self._renderEvents();
  };

  PhoenixUI.prototype._renderEvents = function () {
    var self = this;
    var list = self._domRefs.eventsList;
    if (!list) return;

    if (self._events.length === 0) {
      list.innerHTML = '<div class="phoenix-events-empty">No events yet.</div>';
      self._domRef_eventsCount.textContent = '0 events';
      return;
    }

    var html = self._events.map(function (ev) {
      return (
        '<div class="phoenix-event-item">' +
          '<span class="phoenix-event-time">' + fmtTime(ev.ts) + '</span>' +
          '<span class="phoenix-event-icon ' + esc(ev.iconCls) + '">' + esc(ev.icon) + '</span>' +
          '<span class="phoenix-event-desc">' + esc(ev.desc) + '</span>' +
        '</div>'
      );
    }).join('');

    list.innerHTML = html;
    self._domRefs.eventsCount.textContent = self._events.length + ' event' + (self._events.length !== 1 ? 's' : '');

    // Auto-scroll top (newest first)
    list.scrollTop = 0;
  };

  PhoenixUI.prototype._clearEvents = function () {
    this._events = [];
    this._renderEvents();
  };

  /* ── Actions --------------------------------------------------------------- */
  PhoenixUI.prototype._handleManualRestart = function () {
    var self = this;
    self._showConfirm(
      'Restart Process',
      'Are you sure you want to manually trigger a restart? This will restart the guarded process immediately.',
      function () {
        self._setButtonLoading(self._domRefs.btnRestart, true);
        self._invoke('phoenix_manual_restart')
          .then(function (res) {
            self._toast(res && res.message ? res.message : 'Restart initiated.', 'info');
            self._appendEvent({ type: 'info', icon: '\u21BB', iconCls: 'ev-restart-init', desc: 'Manual restart triggered by user.' });
          })
          .catch(function (err) {
            self._toast('Restart failed: ' + (err || 'Unknown error'), 'error');
          })
          .finally(function () {
            self._setButtonLoading(self._domRefs.btnRestart, false);
          });
      }
    );
  };

  PhoenixUI.prototype._toggleEnabled = function (enabled) {
    var self = this;
    var cmd = enabled ? 'phoenix_enable' : 'phoenix_disable';
    self._invoke(cmd)
      .then(function () {
        self._toast(enabled ? 'Phoenix guardian enabled.' : 'Phoenix guardian disabled.', 'success');
        self._appendEvent({
          type: 'info', icon: enabled ? '\u2713' : '\u2717',
          iconCls: enabled ? 'ev-restart-success' : 'ev-restart-failed',
          desc: enabled ? 'Guardian enabled.' : 'Guardian disabled.'
        });
        // Refresh status
        self._fetchInitialStatus();
      })
      .catch(function (err) {
        self._toast('Failed to toggle: ' + (err || 'Unknown error'), 'error');
        // Revert toggle
        if (self._domRefs.toggleEnabled) self._domRefs.toggleEnabled.checked = !enabled;
      });
  };

  PhoenixUI.prototype._saveConfig = function () {
    var self = this;
    var config = {
      check_interval_secs: parseInt(self._getValue('phxCfgInterval'), 10) || 30,
      health_timeout_secs: parseInt(self._getValue('phxCfgTimeout'), 10) || 10,
      max_restart_attempts: parseInt(self._getValue('phxCfgMaxRestarts'), 10) || 5,
      backoff_base_secs: parseInt(self._getValue('phxCfgBackoffBase'), 10) || 2,
      backoff_cap_secs: parseInt(self._getValue('phxCfgBackoffCap'), 10) || 60
    };

    self._setButtonLoading(self._domRefs.btnSaveCfg, true);
    self._invoke('phoenix_set_config', { config: config })
      .then(function () {
        self._toast('Configuration saved successfully.', 'success');
        self._appendEvent({ type: 'info', icon: '\u2699', iconCls: 'ev-info', desc: 'Configuration updated.' });
      })
      .catch(function (err) {
        self._toast('Failed to save config: ' + (err || 'Unknown error'), 'error');
      })
      .finally(function () {
        self._setButtonLoading(self._domRefs.btnSaveCfg, false);
      });
  };

  /* ── Tauri Event Handlers ------------------------------------------------- */
  PhoenixUI.prototype._handleStatusChanged = function (payload) {
    var self = this;
    var oldSt = (payload && payload.old_status) || '';
    var newSt = (payload && payload.new_status) || '';
    self._updateStatusIndicator(newSt);
    self._appendEvent({
      type: 'StatusChanged',
      icon: EVENT_ICONS['StatusChanged'].icon,
      iconCls: EVENT_ICONS['StatusChanged'].cls,
      desc: 'Status changed: ' + oldSt + ' \u2192 ' + newSt
    });
    // Re-fetch full snapshot after a brief delay so backend has settled
    clearTimeout(self._refetchTmr);
    self._refetchTmr = setTimeout(function () { self._fetchInitialStatus(); }, 500);
  };

  PhoenixUI.prototype._handleHealthCheckPassed = function (payload) {
    var self = this;
    var detail = payload ? payload.details || '' : '';
    var rt = payload && payload.response_time_ms != null ? payload.response_time_ms + 'ms' : '';
    self._appendEvent({
      type: 'HealthCheckPassed',
      icon: EVENT_ICONS['HealthCheckPassed'].icon,
      iconCls: EVENT_ICONS['HealthCheckPassed'].cls,
      desc: 'Health check passed' + (rt ? ' (' + rt + ')' : '') + (detail ? ' \u2014 ' + detail : '')
    });
    // Update last health check time in detail panel
    if (self._domRefs.dsHealth) {
      self._domRefs.dsHealth.textContent = new Date().toLocaleString();
    }
  };

  PhoenixUI.prototype._handleHealthCheckFailed = function (payload) {
    var self = this;
    var detail = payload ? payload.details || '' : '';
    self._appendEvent({
      type: 'HealthCheckFailed',
      icon: EVENT_ICONS['HealthCheckFailed'].icon,
      iconCls: EVENT_ICONS['HealthCheckFailed'].cls,
      desc: 'Health check failed' + (detail ? ' \u2014 ' + detail : '')
    });
  };

  PhoenixUI.prototype._handleCrashDetected = function (payload) {
    var self = this;
    var exitCode = payload ? payload.exit_code : '?';
    var upSecs = payload && payload.uptime_secs != null ? fmtUptime(payload.uptime_secs) : '';
    self._appendEvent({
      type: 'CrashDetected',
      icon: EVENT_ICONS['CrashDetected'].icon,
      iconCls: EVENT_ICONS['CrashDetected'].cls,
      desc: 'Process crashed (exit code: ' + exitCode + ')' + (upSecs ? ', uptime: ' + upSecs : '')
    });
    self._toast('Process crash detected! Exit code: ' + exitCode, 'warning');
    // Refresh status to pick up new crash count
    self._fetchInitialStatus();
  };

  PhoenixUI.prototype._handleRestartInitiated = function (payload) {
    var self = this;
    var attempt = payload ? payload.attempt : '?';
    var max = payload ? payload.max_attempts : '?';
    var backoff = payload && payload.backoff_secs != null ? payload.backoff_secs + 's backoff' : '';
    self._appendEvent({
      type: 'RestartInitiated',
      icon: EVENT_ICONS['RestartInitiated'].icon,
      iconCls: EVENT_ICONS['RestartInitiated'].cls,
      desc: 'Restart #' + attempt + '/' + max + (backoff ? ' (' + backoff + ')' : '')
    });
  };

  PhoenixUI.prototype._handleRestartSuccess = function (payload) {
    var self = this;
    var upSecs = payload && payload.uptime_secs != null ? fmtUptime(payload.uptime_secs) : '';
    self._appendEvent({
      type: 'RestartSuccess',
      icon: EVENT_ICONS['RestartSuccess'].icon,
      iconCls: EVENT_ICONS['RestartSuccess'].cls,
      desc: 'Restart successful' + (upSecs ? ', uptime: ' + upSecs : '')
    });
    self._toast('Process restarted successfully.', 'success');
    self._fetchInitialStatus();
  };

  PhoenixUI.prototype._handleRestartFailed = function (payload) {
    var self = this;
    var reason = payload ? payload.reason || 'Unknown reason' : 'Unknown reason';
    var attempt = payload ? payload.attempt : '?';
    self._appendEvent({
      type: 'RestartFailed',
      icon: EVENT_ICONS['RestartFailed'].icon,
      iconCls: EVENT_ICONS['RestartFailed'].cls,
      desc: 'Restart failed (attempt ' + attempt + '): ' + reason
    });
    self._toast('Restart failed: ' + reason, 'error');
  };

  /* ── Data Fetching -------------------------------------------------------- */
  PhoenixUI.prototype._fetchInitialStatus = function () {
    var self = this;
    self._invoke('phoenix_get_state')
      .then(function (snap) {
        if (snap) self._updateDetailPanel(snap);
      })
      .catch(function () {
        // Silently fail — may not be implemented yet
      });

    // Also fetch stats
    self._invoke('phoenix_get_stats')
      .then(function (stats) {
        if (stats) self._updateStats(stats);
      })
      .catch(function () {});

    // And recent events
    self._invoke('phoenix_get_events', { limit: 20 })
      .then(function (events) {
        if (events && Array.isArray(events) && events.length) {
          events.forEach(function (ev) {
            // Each entry is a serde externally-tagged enum: { "VariantName": { ...fields } }
            var variant = Object.keys(ev)[0];
            var data = ev[variant];
            var info = EVENT_ICONS[variant] || { icon: '\u2022', iconCls: 'ev-info' };
            // Extract a human-readable description from the variant data.
            var desc = '';
            switch (variant) {
              case 'StatusChanged':
                desc = 'Status changed: ' + (data && data.old_status || '') + ' \u2192 ' + (data && data.new_status || ''); break;
              case 'HealthCheckPassed':
                desc = 'Health check passed' + (data && data.result && data.result.response_time_ms != null ? ' (' + data.result.response_time_ms + 'ms)' : ''); break;
              case 'HealthCheckFailed':
                desc = 'Health check failed'; break;
              case 'CrashDetected':
                desc = 'Process crashed (exit code: ' + (data && data.exit_code || '?') + ')'; break;
              case 'RestartInitiated':
                desc = 'Restart #' + (data && data.attempt || '?') + '/' + (data && data.max_attempts || '?'); break;
              case 'RestartSuccess':
                desc = 'Restart successful'; break;
              case 'RestartFailed':
                desc = 'Restart failed: ' + (data && data.reason || 'Unknown'); break;
              default:
                desc = (data && data.details) || (data && data.desc) || '';
            }
            self._events.push({
              ts: (data && data.timestamp) || Date.now(),
              type: variant,
              icon: info.icon,
              iconCls: info.cls,
              desc: desc
            });
          });
          // Trim
          if (self._events.length > MAX_EVENTS) self._events = self._events.slice(0, MAX_EVENTS);
          self._renderEvents();
        }
      })
      .catch(function () {});
  };

  /* ── Tauri Helpers -------------------------------------------------------- */
  PhoenixUI.prototype._invoke = function (cmd, args) {
    var self = this;
    if (self._tauri) {
      return self._tauri.invoke(cmd, args || {});
    }
    // Return a rejected promise when not in Tauri
    return Promise.reject('Not running in Tauri environment');
  };

  PhoenixUI.prototype._listenEvent = function (event, handler) {
    var self = this;
    if (self._tauri) {
      self._tauri.listen(event, function (evt) {
        if (self._destroyed) return;
        try { handler(evt.payload || evt); } catch (e) { console.error('[Phoenix] Event handler error:', e); }
      }).then(function (id) {
        self._listeners.push({ id: id, event: event });
      }).catch(function (err) {
        console.warn('[Phoenix] Failed to listen to ' + event + ':', err);
      });
    }
  };

  /* ── UI Helpers ----------------------------------------------------------- */
  PhoenixUI.prototype._showConfirm = function (title, desc, onConfirm) {
    var self = this;
    var overlay = document.createElement('div');
    overlay.className = 'phoenix-overlay';
    overlay.innerHTML =
      '<div class="phoenix-dialog">' +
        '<div class="phoenix-dialog-title">' + esc(title) + '</div>' +
        '<div class="phoenix-dialog-desc">' + esc(desc) + '</div>' +
        '<div class="phoenix-dialog-actions">' +
          '<button class="phoenix-btn" type="button" data-phx-action="cancel">Cancel</button>' +
          '<button class="phoenix-btn danger" type="button" data-phx-action="confirm">Confirm</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      var action = e.target.getAttribute('data-phx-action');
      if (action === 'confirm') {
        overlay.parentNode.removeChild(overlay);
        onConfirm();
      } else if (action === 'cancel' || e.target === overlay) {
        overlay.parentNode.removeChild(overlay);
      }
    });
  };

  PhoenixUI.prototype._toast = function (message, type) {
    type = type || 'info';
    var el = document.createElement('div');
    el.className = 'phoenix-toast toast-' + type;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 3000);
  };

  PhoenixUI.prototype._setButtonLoading = function (btn, loading) {
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
      btn.originalText = btn.innerHTML;
      btn.innerHTML = '<span class="phx-spinner"></span> Loading...';
    } else {
      btn.innerHTML = btn.originalText || btn.innerHTML.replace(/<span class="phx-spinner"><\/span>\s*/, '');
    }
  };

  PhoenixUI.prototype._getValue = function (id) {
    var el = this._domRefs[id];
    return el ? el.value : '';
  };

  /* ── Mock Data (dev mode) ------------------------------------------------- */
  PhoenixUI.prototype._applyMockData = function () {
    var self = this;
    self._updateDetailPanel({
      status: 'Running',
      uptime_secs: 86400 + 3600 + 120,
      crash_count: 2,
      consecutive_failures: 0,
      last_health_check: Date.now() - 30000,
      enabled: true,
      config: {
        check_interval_secs: 30,
        health_timeout_secs: 10,
        max_restart_attempts: 5,
        backoff_base_secs: 2,
        backoff_cap_secs: 60
      }
    });
    self._updateStats({
      total_uptime_secs: 604800,
      total_crashes: 2,
      avg_response_time_ms: 45,
      restart_success_rate: 0.91,
      phoenix_uptime_secs: 172800
    });
    // Inject some fake events
    var now = Date.now();
    var mockEvents = [
      { ts: now - 60000,   icon: '\u2713', iconCls: 'ev-health-passed', desc: 'Health check passed (42ms)' },
      { ts: now - 120000,  icon: '\u2713', iconCls: 'ev-health-passed', desc: 'Health check passed (38ms)' },
      { ts: now - 180000,  icon: '\u2713', iconCls: 'ev-health-passed', desc: 'Health check passed (51ms)' },
      { ts: now - 360000,  icon: '\u25B6', iconCls: 'ev-status-change',  desc: 'Status changed: Crashed \u2192 Running' },
      { ts: now - 361000,  icon: '\u2713', iconCls: 'ev-restart-success', desc: 'Restart successful, uptime: 0s' },
      { ts: now - 370000,  icon: '\u21BB', iconCls: 'ev-restart-init',   desc: 'Restart #1/5 (2s backoff)' },
      { ts: now - 380000,  icon: '\u26A0', iconCls: 'ev-crash',          desc: 'Process crashed (exit code: 1), uptime: 2h 14m 31s' },
      { ts: now - 7200000, icon: '\u25B6', iconCls: 'ev-status-change',  desc: 'Status changed: Starting \u2192 Running' }
    ];
    mockEvents.forEach(function (ev) {
      self._events.push(ev);
    });
    self._renderEvents();
  };

  /* ── Export --------------------------------------------------------------- */
  window.PhoenixUI = PhoenixUI;

})();
