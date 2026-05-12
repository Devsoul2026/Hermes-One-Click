(function () {
    'use strict';

    var EVENT_ICONS = {
        StatusChanged: { icon: '\u2139\uFE0F', cls: 'phx-ev-info' },
        HealthCheckPassed: { icon: '\u2705', cls: 'phx-ev-success' },
        HealthCheckFailed: { icon: '\u26A0\uFE0F', cls: 'phx-ev-warn' },
        CrashDetected: { icon: '\uD83D\uDCD7', cls: 'phx-ev-error' },
        RestartInitiated: { icon: '\uD83C\uDF0B', cls: 'phx-ev-info' },
        RestartSuccess: { icon: '\uD83C\uDD98', cls: 'phx-ev-success' },
        RestartFailed: { icon: '\u274C', cls: 'phx-ev-error' },
    };

    var STATUS_CLASSES = {
        running: 'phx-running',
        starting: 'phx-starting',
        stopping: 'phx-stopping',
        crashed: 'phx-crashed',
        unknown: 'phx-unknown',
        disabled: 'phx-disabled',
    };

    var STATUS_LABELS = {
        running: 'Running',
        starting: 'Starting',
        stopping: 'Stopping',
        crashed: 'Crashed',
        unknown: 'Unknown',
        disabled: 'Disabled',
    };

    var MAX_EVENTS = 100;
    var API_BASE = '/api/phoenix';

    function PhoenixUI(container) {
        this._container = container;
        this._panel = null;
        this._eventsList = null;
        this._uptimeEl = null;
        this._statusLabel = null;
        this._dot = null;
        this._pill = null;
        this._eventSource = null;
        this._uptimeTimer = null;
        this._uptimeBase = 0;
        this._events = [];
        this._currentStatus = 'unknown';
        this._enabled = true;
        this._destroyed = false;
        this._reconnectTimeout = null;
    }

    PhoenixUI.prototype.init = function () {
        if (this._destroyed) return;
        this._injectStyles();
        this._buildIndicator();
        this._buildPanel();
        this._wireControls();
        this._fetchInitialStatus();
        this._connectSSE();
    };

    PhoenixUI.prototype.destroy = function () {
        this._destroyed = true;
        if (this._reconnectTimeout) {
            clearTimeout(this._reconnectTimeout);
            this._reconnectTimeout = null;
        }
        if (this._uptimeTimer) {
            clearInterval(this._uptimeTimer);
            this._uptimeTimer = null;
        }
        if (this._eventSource) {
            this._eventSource.close();
            this._eventSource = null;
        }
        if (this._pill && this._pill.parentNode) {
            this._pill.removeEventListener('click', this._boundToggle);
        }
        document.removeEventListener('click', this._boundDocClick);
        var overlay = document.querySelector('.phoenix-overlay');
        if (overlay) overlay.remove();
        if (this._container) {
            this._container.innerHTML = '';
        }
    };

    PhoenixUI.prototype._injectStyles = function () {
        if (document.getElementById('phoenix-styles')) return;
        var link = document.createElement('link');
        link.id = 'phoenix-styles';
        link.rel = 'stylesheet';
        link.href = 'static/phoenix-ui.css?v=' + (window.__WEBUI_VERSION__ || '1');
        document.head.appendChild(link);
    };

    PhoenixUI.prototype._buildIndicator = function () {
        var pill = document.createElement('div');
        pill.className = 'phoenix-pill';
        pill.innerHTML =
            '<div class="phoenix-dot phx-unknown"></div>' +
            '<span class="phoenix-label">Phoenix</span>';
        this._pill = pill;
        this._dot = pill.querySelector('.phoenix-dot');
        this._statusLabel = pill.querySelector('.phoenix-label');
        this._boundToggle = this._togglePanel.bind(this);
        pill.addEventListener('click', this._boundToggle);
        this._container.appendChild(pill);
    };

    PhoenixUI.prototype._buildPanel = function () {
        var panel = document.createElement('div');
        panel.className = 'phoenix-panel phx-collapsed';
        panel.innerHTML =
            '<div class="phoenix-section">' +
            '  <div class="phoenix-section-header" data-section="stats">' +
            '    <span class="phoenix-chevron">&#9654;</span> Status & Stats' +
            '  </div>' +
            '  <div class="phoenix-section-body">' +
            '    <div class="phoenix-stats-row">' +
            '      <div class="phoenix-stat"><b>Uptime</b><span id="phx-uptime">--</span></div>' +
            '      <div class="phoenix-stat"><b>Crashes</b><span id="phx-crashes">0</span></div>' +
            '      <div class="phoenix-stat"><b>Success</b><span id="phx-success">100%</span></div>' +
            '    </div>' +
            '    <div class="phoenix-detail-grid">' +
            '      <div class="phoenix-detail-item"><label>Status</label><span id="phx-status-val">Unknown</span></div>' +
            '      <div class="phoenix-detail-item"><label>Last Check</label><span id="phx-last-check">Never</span></div>' +
            '      <div class="phoenix-detail-item"><label>Failures</label><span id="phx-failures">0</span></div>' +
            '      <div class="phoenix-detail-item"><label>Restarts</label><span id="phx-restarts">0</span></div>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="phoenix-section">' +
            '  <div class="phoenix-section-header" data-section="controls">' +
            '    <span class="phoenix-chevron">&#9654;</span> Controls' +
            '  </div>' +
            '  <div class="phoenix-section-body">' +
            '    <div class="phoenix-controls-row">' +
            '      <button id="phx-restart-btn" class="phoenix-btn phoenix-btn-primary" type="button">\u{1F504} Restart Gateway</button>' +
            '      <label class="phoenix-toggle"><input type="checkbox" id="phx-enable-toggle" checked><span class="phoenix-toggle-track"></span> Enabled</label>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="phoenix-section">' +
            '  <div class="phoenix-section-header" data-section="config">' +
            '    <span class="phoenix-chevron">&#9654;</span> Config' +
            '  </div>' +
            '  <div class="phoenix-section-body">' +
            '    <div class="phoenix-config-grid">' +
            '      <div class="phoenix-config-item"><label>Check Interval (s)</label><input type="number" id="phx-cfg-interval" min="1" max="300" step="1"></div>' +
            '      <div class="phoenix-config-item"><label>Timeout (s)</label><input type="number" id="phx-cfg-timeout" min="1" max="60" step="1"></div>' +
            '      <div class="phoenix-config-item"><label>Max Restarts</label><input type="number" id="phx-cfg-max-restarts" min="1" max="50" step="1"></div>' +
            '      <div class="phoenix-config-item"><label>Backoff Base (s)</label><input type="number" id="phx-cfg-backoff-base" min="1" max="120" step="1"></div>' +
            '      <div class="phoenix-config-item"><label>Backoff Max (s)</label><input type="number" id="phx-cfg-backoff-max" min="10" max="3600" step="10"></div>' +
            '      <button id="phx-save-config" class="phoenix-btn" type="button">Save Config</button>' +
            '    </div>' +
            '  </div>' +
            '</div>' +
            '<div class="phoenix-section">' +
            '  <div class="phoenix-section-header" data-section="events">' +
            '    <span class="phoenix-chevron">&#9654;</span> Event Log <span id="phx-event-count">(0)</span>' +
            '  </div>' +
            '  <div class="phoenix-section-body">' +
            '    <div id="phx-events-list" class="phoenix-events-list"></div>' +
            '    <button id="phx-clear-events" class="phoenix-btn phoenix-btn-small" type="button">Clear</button>' +
            '  </div>' +
            '</div>';
        this._panel = panel;
        this._container.appendChild(panel);
        this._uptimeEl = document.getElementById('phx-uptime');
        this._eventsList = document.getElementById('phx-events-list');
        this._bindSectionToggle();
    };

    PhoenixUI.prototype._togglePanel = function (e) {
        e.stopPropagation();
        if (!this._panel) return;
        this._panel.classList.toggle('phx-collapsed');
    };

    PhoenixUI.prototype._bindSectionToggle = function () {
        var headers = this._panel.querySelectorAll('.phoenix-section-header');
        headers.forEach(function (h) {
            h.addEventListener('click', function () {
                h.classList.toggle('phx-open');
                var body = h.nextElementSibling;
                if (body) body.classList.toggle('phx-open');
            });
        });
    };

    PhoenixUI.prototype._wireControls = function () {
        var self = this;
        var restartBtn = document.getElementById('phx-restart-btn');
        if (restartBtn) restartBtn.addEventListener('click', function () { self._handleManualRestart(); });

        var enableToggle = document.getElementById('phx-enable-toggle');
        if (enableToggle) enableToggle.addEventListener('change', function () {
            self._toggleEnabled(this.checked);
        });

        var saveBtn = document.getElementById('phx-save-config');
        if (saveBtn) saveBtn.addEventListener('click', function () { self._saveConfig(); });

        var clearBtn = document.getElementById('phx-clear-events');
        if (clearBtn) clearBtn.addEventListener('click', function () { self._clearEvents(); });

        this._boundDocClick = function (e) {
            if (self._panel && !self._panel.contains(e.target) && !self._pill.contains(e.target)) {
                self._panel.classList.add('phx-collapsed');
            }
        };
        document.addEventListener('click', this._boundDocClick);
    };

    PhoenixUI.prototype._apiCall = function (endpoint, options) {
        options = options || {};
        var url = API_BASE + endpoint;
        var fetchOpts = {
            method: options.method || 'GET',
            headers: { 'Content-Type': 'application/json' },
        };
        if (options.body) fetchOpts.body = JSON.stringify(options.body);
        return fetch(url, fetchOpts).then(function (resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.json();
        }).catch(function (err) {
            console.warn('[phoenix] API error:', endpoint, err);
            throw err;
        });
    };

    PhoenixUI.prototype._connectSSE = function () {
        var self = this;
        if (this._eventSource) {
            this._eventSource.close();
            this._eventSource = null;
        }
        try {
            this._eventSource = new EventSource(API_BASE + '/stream');
            this._eventSource.onmessage = function (e) {
                try {
                    var payload = JSON.parse(e.data);
                    if (payload.type === 'initial') {
                        self._updateDetailPanel(payload.data || payload);
                        return;
                    }
                    self._handleEvent(payload.type, payload.data || {});
                } catch (err) {
                    console.warn('[phoenix] SSE parse error:', err);
                }
            };
            this._eventSource.onerror = function () {
                console.warn('[phoenix] SSE connection lost, reconnecting in 5s...');
                self._reconnectTimeout = setTimeout(function () {
                    if (!self._destroyed) self._connectSSE();
                }, 5000);
            };
        } catch (err) {
            console.warn('[phoenix] SSE not available:', err);
        }
    };

    PhoenixUI.prototype._fetchInitialStatus = function () {
        var self = this;
        Promise.all([
            this._apiCall('/status').catch(function () { return null; }),
            this._apiCall('/stats').catch(function () { return null; }),
            this._apiCall('/events?limit=20').catch(function () { return { events: [] }; }),
        ]).then(function (results) {
            var status = results[0];
            var stats = results[1];
            var events = results[2];
            if (status) self._updateDetailPanel(status);
            if (stats) self._updateStats(stats);
            if (events && events.events) {
                events.events.forEach(function (ev) {
                    self._appendEvent(ev);
                });
            }
        });
    };

    PhoenixUI.prototype._updateStatusIndicator = function (status) {
        this._currentStatus = status;
        var cls = STATUS_CLASSES[status] || 'phx-unknown';
        if (this._dot) {
            this._dot.className = 'phoenix-dot ' + cls;
        }
        if (this._statusLabel) {
            var label = STATUS_LABELS[status] || 'Unknown';
            this._statusLabel.textContent = label;
        }
    };

    PhoenixUI.prototype._updateDetailPanel = function (snapshot) {
        if (!snapshot) return;
        var status = snapshot.status || 'unknown';
        this._updateStatusIndicator(status);
        this._enabled = snapshot.enabled !== false;

        var statusVal = document.getElementById('phx-status-val');
        if (statusVal) {
            statusVal.textContent = STATUS_LABELS[status] || status;
            statusVal.className = '';
            if (status === 'crashed') statusVal.classList.add('error');
            else if (status === 'running') statusVal.classList.add('success');
        }

        var uptimeEl = document.getElementById('phx-uptime');
        if (uptimeEl && snapshot.uptime_secs != null) {
            this._uptimeBase = Date.now() - (snapshot.uptime_secs * 1000);
            this._startUptimeTimer();
        }

        var lastCheck = document.getElementById('phx-last-check');
        if (lastCheck && snapshot.last_health_check) {
            lastCheck.textContent = _formatTime(snapshot.last_health_check);
        }

        var failures = document.getElementById('phx-failures');
        if (failures) failures.textContent = snapshot.consecutive_failures || 0;

        var crashes = document.getElementById('phx-crashes');
        if (crashes) crashes.textContent = snapshot.crash_count || 0;

        var config = snapshot.config || {};
        _setVal('phx-cfg-interval', config.check_interval_secs);
        _setVal('phx-cfg-timeout', config.health_check_timeout_secs);
        _setVal('phx-cfg-max-restarts', config.max_restart_attempts);
        _setVal('phx-cfg-backoff-base', config.restart_backoff_base_secs);
        _setVal('phx-cfg-backoff-max', config.restart_backoff_max_secs);

        var toggle = document.getElementById('phx-enable-toggle');
        if (toggle) toggle.checked = this._enabled;
    };

    PhoenixUI.prototype._updateStats = function (stats) {
        if (!stats) return;
        var restarts = document.getElementById('phx-restarts');
        if (restarts) restarts.textContent = stats.total_restarts || 0;
        var success = document.getElementById('phx-success');
        if (success) success.textContent = (stats.restart_success_rate || 100) + '%';
    };

    PhoenixUI.prototype._startUptimeTimer = function () {
        var self = this;
        if (this._uptimeTimer) clearInterval(this._uptimeTimer);
        this._uptimeTimer = setInterval(function () {
            if (self._uptimeEl) {
                self._renderUptime();
            }
        }, 1000);
    };

    PhoenixUI.prototype._renderUptime = function () {
        if (!this._uptimeEl) return;
        var elapsed = (Date.now() - this._uptimeBase) / 1000;
        this._uptimeEl.textContent = _formatDuration(elapsed);
    };

    PhoenixUI.prototype._handleEvent = function (type, data) {
        switch (type) {
            case 'StatusChanged':
                this._updateStatusIndicator(data.new_status || 'unknown');
                break;
            case 'HealthCheckPassed':
            case 'HealthCheckFailed':
            case 'CrashDetected':
            case 'RestartInitiated':
            case 'RestartSuccess':
            case 'RestartFailed':
                break;
            default:
                return;
        }
        this._appendEvent({ type: type, timestamp: data.timestamp || (Date.now() / 1000), data: data });
        this._refreshCounts();
    };

    PhoenixUI.prototype._appendEvent = function (event) {
        this._events.unshift(event);
        if (this._events.length > MAX_EVENTS) this._events.pop();
        this._renderEvents();
    };

    PhoenixUI.prototype._renderEvents = function () {
        if (!this._eventsList) return;
        var html = '';
        for (var i = 0; i < Math.min(this._events.length, 30); i++) {
            var ev = this._events[i];
            var info = EVENT_ICONS[ev.type] || { icon: '\u2022', cls: '' };
            var desc = this._describeEvent(ev.type, ev.data || {});
            html +=
                '<div class="phoenix-event-item ' + info.cls + '">' +
                '<span class="phoenix-event-icon">' + info.icon + '</span>' +
                '<span class="phoenix-event-time">' + _formatTime(ev.timestamp) + '</span>' +
                '<span class="phoenix-event-desc">' + desc + '</span>' +
                '</div>';
        }
        this._eventsList.innerHTML = html;
        this._refreshCounts();
    };

    PhoenixUI.prototype._describeEvent = function (type, data) {
        switch (type) {
            case 'StatusChanged': return 'Status: ' + (data.old_status || '?') + ' \u2192 ' + (data.new_status || '?');
            case 'HealthCheckPassed': return 'Healthy (PID=' + (data.pid || '?') + ', ' + (data.response_time_ms || '?') + 'ms)';
            case 'HealthCheckFailed': return 'Unhealthy: ' + (data.details || 'no response');
            case 'CrashDetected': return 'Crash #' + (data.crash_count || '?') + ' (up ' + _formatDuration(data.uptime_secs || 0) + ')';
            case 'RestartInitiated': return 'Restart attempt ' + (data.attempt || '?') + '/' + (data.max_attempts || '?') + ' in ' + (data.backoff_secs || '?') + 's';
            case 'RestartSuccess': return 'Restart OK (PID=' + (data.pid || '?') + ')';
            case 'RestartFailed': return 'Restart failed: ' + (data.reason || 'unknown');
            default: return type;
        }
    };

    PhoenixUI.prototype._refreshCounts = function () {
        var countEl = document.getElementById('phx-event-count');
        if (countEl) countEl.textContent = '(' + this._events.length + ')';
    };

    PhoenixUI.prototype._clearEvents = function () {
        this._events = [];
        this._renderEvents();
    };

    PhoenixUI.prototype._handleManualRestart = function () {
        var self = this;
        var btn = document.getElementById('phx-restart-btn');
        if (btn) btn.disabled = true;
        this._showConfirm('Restart Gateway', 'This will restart the Hermes Gateway process. Continue?', function () {
            self._apiCall('/restart', { method: 'POST' }).then(function (result) {
                self._toast(result.message || result.error || 'Done', result.error ? 'error' : 'success');
            }).catch(function () {
                self._toast('Restart request failed', 'error');
            }).finally(function () {
                if (btn) btn.disabled = false;
            });
        }, function () {
            if (btn) btn.disabled = false;
        });
    };

    PhoenixUI.prototype._toggleEnabled = function (enabled) {
        var endpoint = enabled ? '/enable' : '/disable';
        var self = this;
        this._apiCall(endpoint, { method: 'POST' }).then(function () {
            self._enabled = enabled;
            self._toast(enabled ? 'Guardian enabled' : 'Guardian disabled', 'info');
        }).catch(function () {
            var toggle = document.getElementById('phx-enable-toggle');
            if (toggle) toggle.checked = !enabled;
            self._toast('Failed to toggle guardian', 'error');
        });
    };

    PhoenixUI.prototype._saveConfig = function () {
        var config = {
            check_interval_secs: parseFloat(_getVal('phx-cfg-interval')) || 10,
            health_check_timeout_secs: parseFloat(_getVal('phx-cfg-timeout')) || 5,
            max_restart_attempts: parseInt(_getVal('phx-cfg-max-restarts')) || 10,
            restart_backoff_base_secs: parseFloat(_getVal('phx-cfg-backoff-base')) || 5,
            restart_backoff_max_secs: parseFloat(_getVal('phx-cfg-backoff-max')) || 300,
        };
        var self = this;
        this._apiCall('/config', { method: 'POST', body: config }).then(function () {
            self._toast('Config saved', 'success');
        }).catch(function () {
            self._toast('Failed to save config', 'error');
        });
    };

    PhoenixUI.prototype._showConfirm = function (title, desc, onConfirm, onCancel) {
        var overlay = document.createElement('div');
        overlay.className = 'phoenix-overlay';
        overlay.innerHTML =
            '<div class="phoenix-dialog">' +
            '<h3>' + title + '</h3>' +
            '<p>' + desc + '</p>' +
            '<div class="phoenix-dialog-actions">' +
            '<button class="phoenix-btn phoenix-btn-danger" data-action="confirm">Confirm</button>' +
            '<button class="phoenix-btn" data-action="cancel">Cancel</button>' +
            '</div>' +
            '</div>';
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) { overlay.remove(); if (onCancel) onCancel(); }
        });
        overlay.querySelector('[data-action="confirm"]').addEventListener('click', function () {
            overlay.remove(); if (onConfirm) onConfirm();
        });
        overlay.querySelector('[data-action="cancel"]').addEventListener('click', function () {
            overlay.remove(); if (onCancel) onCancel();
        });
        document.body.appendChild(overlay);
    };

    PhoenixUI.prototype._toast = function (msg, type) {
        type = type || 'info';
        var toast = document.createElement('div');
        toast.className = 'phoenix-toast phoenix-toast-' + type;
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(function () {
            toast.classList.add('phoenix-toast-hiding');
            setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 400);
        }, 2500);
    };

    function _setVal(id, val) {
        var el = document.getElementById(id);
        if (el && val != null) el.value = val;
    }

    function _getVal(id) {
        var el = document.getElementById(id);
        return el ? el.value : '';
    }

    function _formatTime(ts) {
        if (!ts || isNaN(ts)) return '--';
        var d = new Date(ts * 1000);
        if (isNaN(d.getTime())) return '--';
        var pad = function (n) { return String(n).padStart(2, '0'); };
        return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    function _formatDuration(secs) {
        if (!secs || secs < 0) return '0s';
        if (secs < 60) return Math.round(secs) + 's';
        if (secs < 3600) return Math.floor(secs / 60) + 'm ' + Math.round(secs % 60) + 's';
        var h = Math.floor(secs / 3600);
        var m = Math.floor((secs % 3600) / 60);
        return h + 'h ' + m + 'm';
    }

    window.PhoenixUI = PhoenixUI;
})();
