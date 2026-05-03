let _gatewayPollTimer = null;
let _gatewayAutoStartAttempted = false;

function _setGatewayUi(running, pid) {
  const dot = $('gatewayStatusDot');
  const line = $('gatewayStatusLine');
  if (dot) {
    dot.classList.remove('on', 'off', 'unknown');
    if (running === true) dot.classList.add('on');
    else if (running === false) dot.classList.add('off');
    else dot.classList.add('unknown');
  }
  if (line) {
    if (running === true) {
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
