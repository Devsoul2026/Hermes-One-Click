const _FEEDBACK_URL = 'https://mcnf6sa14lqh.feishu.cn/share/base/form/shrcn1a75pLcTF6YtWhJZlObqIg';

function _ft(key, ...args) {
  if (typeof t === 'function') return t(key, ...args);
  // Minimal fallback map when i18n isn't loaded yet
  const fb = {
    feedback_status_loading: '正在读取日志状态…',
    feedback_status_size: (mb) => `当前诊断日志约 ${mb} MB，每日自动清理。`,
    feedback_status_error: (msg) => `读取日志状态失败：${msg}`,
    feedback_exporting: '正在导出…',
    feedback_export_success: (f) => `✓ 已导出：${f}`,
    feedback_export_fail: (msg) => `导出失败：${msg}`,
    feedback_export_toast_ok: '日志已导出，请点击「前往提交问题」上传日志。',
    feedback_export_toast_fail: (msg) => `日志导出失败：${msg}`,
    feedback_export_btn: '导出日志',
    feedback_open_toast: '已在浏览器中打开反馈表单。',
  };
  const val = fb[key];
  if (val === undefined) return key;
  return typeof val === 'function' ? val(...args) : val;
}

function openLogsModal() {
  const modal = document.getElementById('logsModal');
  const status = document.getElementById('logsModalStatus');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  _resetFeedbackSteps();
  if (status) status.textContent = _ft('feedback_status_loading');
  api('/api/logs/status').then(data => {
    if (!status) return;
    const size = Number(data.client_events_size || 0);
    const mb = (size / 1024 / 1024).toFixed(2);
    status.textContent = _ft('feedback_status_size', mb);
  }).catch(e => {
    if (status) status.textContent = _ft('feedback_status_error', e.message || e);
  });
}

function closeLogsModal() {
  const modal = document.getElementById('logsModal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
}

function _resetFeedbackSteps() {
  const s1 = document.getElementById('feedbackStep1');
  const n1 = document.getElementById('feedbackStep1Num');
  const feedbackBtn = document.getElementById('btnOpenFeedback');
  if (s1) s1.classList.remove('feedback-step--done');
  if (n1) { n1.textContent = '1'; n1.classList.remove('done'); }
  if (feedbackBtn) feedbackBtn.classList.remove('feedback-action-btn--pulse');
}

async function exportHermesLogs() {
  const btn = document.getElementById('btnExportHermesLogs');
  const status = document.getElementById('logsModalStatus');
  const exportLabel = btn ? btn.querySelector('span[data-i18n="feedback_export_btn"]') : null;
  if (exportLabel) exportLabel.textContent = _ft('feedback_exporting');
  else if (btn) btn.textContent = _ft('feedback_exporting');
  if (btn) btn.disabled = true;
  if (status) status.textContent = _ft('feedback_exporting');
  try {
    const res = await fetch(new URL('api/logs/export', document.baseURI || location.href).href, { credentials: 'include' });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const match = /filename="([^"]+)"/i.exec(cd);
    const filename = match ? match[1] : `hermes-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    if (status) status.textContent = _ft('feedback_export_success', filename);
    if (typeof showToast === 'function') showToast(_ft('feedback_export_toast_ok'), 4000, 'success');
    // Mark step 1 done, highlight step 2
    const s1 = document.getElementById('feedbackStep1');
    const n1 = document.getElementById('feedbackStep1Num');
    const feedbackBtn = document.getElementById('btnOpenFeedback');
    if (s1) s1.classList.add('feedback-step--done');
    if (n1) { n1.textContent = '✓'; n1.classList.add('done'); }
    if (feedbackBtn) feedbackBtn.classList.add('feedback-action-btn--pulse');
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (status) status.textContent = _ft('feedback_export_fail', msg);
    if (typeof showToast === 'function') showToast(_ft('feedback_export_toast_fail', msg), 3600, 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (exportLabel) exportLabel.textContent = _ft('feedback_export_btn');
    else if (btn) btn.textContent = _ft('feedback_export_btn');
  }
}

async function openFeedbackUrl() {
  try {
    await api('/api/open-url', { method: 'POST', body: JSON.stringify({ url: _FEEDBACK_URL }) });
  } catch (_) {
    window.open(_FEEDBACK_URL, '_blank', 'noopener,noreferrer');
  }
  if (typeof showToast === 'function') showToast(_ft('feedback_open_toast'), 2500, 'success');
}

if (typeof window !== 'undefined') {
  window.openLogsModal = openLogsModal;
  window.closeLogsModal = closeLogsModal;
  window.exportHermesLogs = exportHermesLogs;
  window.openFeedbackUrl = openFeedbackUrl;
}
