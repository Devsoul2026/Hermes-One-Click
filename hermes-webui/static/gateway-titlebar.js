let _gatewayPollTimer = null;
let _gatewayAutoStartAttempted = false;

function _setGatewayUi(running, pid, extraState) {
  const dot = $('gatewayStatusDot');
  const line = $('gatewayStatusLine');
  if (dot) {
    dot.classList.remove('on', 'off', 'unknown', 'crashed', 'restarting');
    if (extraState === 'crashed') dot.classList.add('crashed');
    else if (extraState === 'restarting') dot.classList.add('restarting');
    else if (running === true) dot.classList.add('on');
    else if (running === false) dot.classList.add('off');
    else dot.classList.add('unknown');
  }
  if (line) {
    if (extraState === 'crashed') {
      line.textContent = typeof t === 'function' ? t('gateway_status_crashed') : '崩溃，恢复中…';
    } else if (extraState === 'restarting') {
      line.textContent = typeof t === 'function' ? t('gateway_status_restarting') : '重启中…';
    } else if (running === true) {
      line.textContent = pid
        ? `${t('gateway_status_running')} · PID ${pid}`
        : t('gateway_status_running');
    } else if (running === false) {
      line.textContent = t('gateway_status_stopped');
    } else {
      line.textContent = t('gateway_status_checking');
    }
  }
}

async function refreshGatewayTitlebar() {
  _setGatewayUi(null, null);
  try {
    const d = await api('/api/gateway/status');
    _setGatewayUi(!!d.running, d.pid);
  } catch (_e) {
    const line = $('gatewayStatusLine');
    if (line) line.textContent = t('gateway_status_error');
    const dot = $('gatewayStatusDot');
    if (dot) {
      dot.classList.remove('on', 'off');
      dot.classList.add('unknown');
    }
  }
}

async function autoStartGatewayIfNeeded() {
  if (_gatewayAutoStartAttempted) return;
  _gatewayAutoStartAttempted = true;
  try {
    const status = await api('/api/gateway/status');
    _setGatewayUi(!!status.running, status.pid);
    if (status.running) return;

    const result = await api('/api/gateway/reload', { method: 'POST', body: '{}' });
    if (result.started || result.restarted || result.pending) {
      let n = 0;
      const burst = setInterval(() => {
        void refreshGatewayTitlebar();
        if (++n >= 18) clearInterval(burst);
      }, 1000);
    } else {
      await refreshGatewayTitlebar();
    }
  } catch (_e) {
    await refreshGatewayTitlebar();
  }
}

async function reloadGatewayFromTitlebar() {
  try {
    const r = await api('/api/gateway/reload', { method: 'POST', body: '{}' });
    if (r.restarted) {
      showToast(t('gateway_reload_ok'), 4000, 'success');
    } else if (r.started) {
      if (r.pending) {
        showToast(t('gateway_start_pending'), 6000, 'success');
        let n = 0;
        const burst = setInterval(() => {
          void refreshGatewayTitlebar();
          if (++n >= 18) clearInterval(burst);
        }, 1000);
      } else {
        showToast(t('gateway_start_ok'), 5000, 'success');
      }
    } else if (r.reason === 'not_running') {
      const hint = r.detail ? `${t('gateway_start_failed')}\n${r.detail}` : t('gateway_reload_not_running');
      showToast(hint, 8000, 'warning');
    } else if (r.reason === 'sigusr1_unavailable') {
      showToast(t('gateway_reload_sigusr'), 6000, 'warning');
    } else {
      showToast(String(r.detail || r.reason || t('gateway_reload_fail')), 5000, 'warning');
    }
    await refreshGatewayTitlebar();
  } catch (e) {
    showToast(`${t('error_prefix')}${e.message || ''}`, 5000, 'error');
  }
}

function initGatewayTitlebar() {
  if (_gatewayPollTimer) clearInterval(_gatewayPollTimer);
  void autoStartGatewayIfNeeded();
  _gatewayPollTimer = setInterval(() => {
    void refreshGatewayTitlebar();
  }, 28000);
}

if (typeof window !== 'undefined') {
  window.refreshGatewayTitlebar = refreshGatewayTitlebar;
  window.reloadGatewayFromTitlebar = reloadGatewayFromTitlebar;
  window.initGatewayTitlebar = initGatewayTitlebar;
}

// ── Phoenix Guardian integration ────────────────────────────────────────────
// Subscribe to the guardian's SSE stream and reflect crash/restart states
// in the existing gateway titlebar — no second indicator needed.

let _phoenixSSE = null;
let _phoenixReconnectTimer = null;

function _connectPhoenixStream() {
  if (_phoenixSSE) return;
  try {
    const url = new URL('api/phoenix/stream', document.baseURI || location.href).href;
    const es = new EventSource(url);
    _phoenixSSE = es;

    es.onmessage = function (e) {
      let ev;
      try { ev = JSON.parse(e.data); } catch (_) { return; }
      const type = ev.type || '';
      const data = ev.data || {};

      if (type === 'CrashDetected') {
        _setGatewayUi(false, null, 'crashed');
        if (typeof showToast === 'function')
          showToast(typeof t === 'function' ? t('gateway_crashed_toast') : '网关进程崩溃，正在自动恢复…', 6000, 'error');
      } else if (type === 'RestartInitiated') {
        _setGatewayUi(false, null, 'restarting');
      } else if (type === 'RestartSuccess') {
        void refreshGatewayTitlebar();
        if (typeof showToast === 'function')
          showToast(typeof t === 'function' ? t('gateway_recovered_toast') : '网关已自动恢复', 4000, 'success');
      } else if (type === 'RestartFailed') {
        _setGatewayUi(false, null, null);
        if (typeof showToast === 'function')
          showToast(typeof t === 'function' ? t('gateway_recover_failed_toast') : '网关自动恢复失败，请手动重启', 8000, 'error');
      } else if (type === 'StatusChanged') {
        const status = data.status || '';
        if (status === 'running') void refreshGatewayTitlebar();
        else if (status === 'crashed') _setGatewayUi(false, null, 'crashed');
        else if (status === 'starting') _setGatewayUi(false, null, 'restarting');
      } else if (type === 'HealthCheckPassed') {
        // Silently keep the "on" state — no UI action needed
      }
    };

    es.onerror = function () {
      es.close();
      _phoenixSSE = null;
      // Retry after 30 s (guardian may not be installed in all environments)
      clearTimeout(_phoenixReconnectTimer);
      _phoenixReconnectTimer = setTimeout(_connectPhoenixStream, 30000);
    };
  } catch (_) {
    // SSE not available or guardian not installed — silent
  }
}

// Kick off phoenix stream connection after the gateway titlebar is ready
(function _initPhoenixIntegration() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_connectPhoenixStream, 5000); });
  } else {
    setTimeout(_connectPhoenixStream, 5000);
  }
})();
