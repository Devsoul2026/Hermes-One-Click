/* Hermes One-Click self-update: version check, download progress, installer launch */

let _ocDownloadId = null;
let _ocPollTimer = null;

// Static fallback CN download links shown when the release body has no parsed links.
// Update these URLs when uploading new cloud-storage packages for each release.
const _OC_CN_LINKS_FALLBACK = [
  { name: '夸克网盘', url: 'https://pan.quark.cn/s/1d713df0ea91' },
  { name: '123网盘',  url: 'https://1855173445.share.123pan.cn/123pan/IM9Cvd-8nJD3?pwd=B0mL#' },
  { name: '百度网盘', url: 'https://pan.baidu.com/s/1SMCFEcggfn_3lOWMm-hMKA?pwd=t9kd' },
];

function _ocEsc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

// ── Version check ────────────────────────────────────────────────────────────

async function _checkOcUpdate() {
  try {
    const data = await api('/api/oc/update-check');
    if (!data) return;

    // Update button badge
    const btn = document.getElementById('btnViewAgentVersion');
    const semverEl = document.getElementById('titlebarAgentSemver');
    if (semverEl && data.current) {
      semverEl.textContent = ' · v' + data.current;
      semverEl.removeAttribute('hidden');
      semverEl.setAttribute('aria-hidden', 'false');
    }
    if (btn) {
      if (data.update_available) {
        btn.classList.add('has-update');
      } else {
        btn.classList.remove('has-update');
      }
    }

    // Notify once per latest version
    if (data.update_available && data.latest) {
      const seenKey = 'hermes-oc-update-seen-' + data.latest;
      if (!localStorage.getItem(seenKey)) {
        localStorage.setItem(seenKey, '1');
        if (typeof showToast === 'function') {
          showToast(
            (typeof t === 'function' ? t('oc_update_available_toast') : '新版本可用') +
            ' v' + data.latest,
            8000,
            'warning'
          );
        }
      }
    }
  } catch (e) {
    // silent — version check is best-effort
  }
}

// ── Modal ────────────────────────────────────────────────────────────────────

function openAgentVersionModal() {
  const modal = document.getElementById('agentVersionModal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  if (typeof applyLocaleToDOM === 'function') applyLocaleToDOM();
  _renderOcUpdateModal();
}

function closeAgentVersionModal() {
  const modal = document.getElementById('agentVersionModal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  _stopOcPoll();
}

async function _renderOcUpdateModal() {
  const body = document.getElementById('agentVersionBody');
  const status = document.getElementById('agentVersionStatus');
  const btnUpdate = document.getElementById('btnAgentMirrorUpdate');
  const btnRefresh = document.getElementById('btnAgentVersionRefresh');

  if (status) status.textContent = typeof t === 'function' ? t('oc_checking') : '检查中…';
  if (body) body.innerHTML = '';
  if (btnUpdate) btnUpdate.style.display = 'none';

  let data = null;
  try {
    data = await api('/api/oc/update-check');
  } catch (e) {
    if (body) body.innerHTML = '<p style="color:var(--error-text,#e55)">' + _ocEsc(String(e && e.message ? e.message : e)) + '</p>';
    if (status) status.textContent = '';
    return;
  }
  if (status) status.textContent = '';

  if (!data) return;

  let html = '';
  html += '<div class="agent-version-row"><strong>' +
    _ocEsc(typeof t === 'function' ? t('oc_current_version') : '当前版本') +
    '</strong> <code>v' + _ocEsc(data.current || '—') + '</code></div>';

  if (data.latest) {
    html += '<div class="agent-version-row"><strong>' +
      _ocEsc(typeof t === 'function' ? t('oc_latest_version') : '最新版本') +
      '</strong> <code>v' + _ocEsc(data.latest) + '</code></div>';
  }

  if (data.error) {
    html += '<p style="margin-top:10px;font-size:12px;color:var(--muted)">' + _ocEsc(data.error) + '</p>';
  } else   if (data.update_available) {
    html += '<p style="margin-top:14px;font-weight:600;color:var(--accent)">' +
      _ocEsc(typeof t === 'function' ? t('oc_update_available') : '发现新版本，点击下方按钮更新') + '</p>';
    if (data.changelog) {
      // Strip the CN-download section from changelog display to avoid duplication
      const cleanLog = data.changelog.replace(/##\s*国内快速下载[\s\S]*/,'').trim();
      if (cleanLog) {
        html += '<pre style="margin-top:8px;font-size:11px;white-space:pre-wrap;color:var(--muted);background:var(--code-bg);padding:8px;border-radius:6px;max-height:120px;overflow:auto">' +
          _ocEsc(cleanLog) + '</pre>';
      }
    }
    // CN cloud-storage download links — use parsed from release body, or static fallback
    const cnLinks = (data.cn_download_links && data.cn_download_links.length > 0)
      ? data.cn_download_links
      : _OC_CN_LINKS_FALLBACK;
    if (cnLinks.length > 0) {
      html += '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">' +
        '<div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:8px">' +
        _ocEsc(typeof t === 'function' ? t('oc_cn_download_title') : '国内快速下载') + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px">';
      for (const lnk of cnLinks) {
        html += '<a href="' + _ocEsc(lnk.url) + '" target="_blank" rel="noopener noreferrer" ' +
          'style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:8px;' +
          'background:var(--surface);border:1px solid var(--border2);color:var(--text);font-size:12px;' +
          'font-weight:500;text-decoration:none;transition:background .15s" ' +
          'onmouseover="this.style.background=\'var(--border2)\'" ' +
          'onmouseout="this.style.background=\'var(--surface)\'">' +
          _ocEsc(lnk.name) + '</a>';
      }
      html += '</div></div>';
    }
    if (btnUpdate) {
      btnUpdate.style.display = 'inline-flex';
      btnUpdate.disabled = false;
      btnUpdate.textContent = typeof t === 'function' ? t('oc_update_btn') : '立即更新';
      btnUpdate.dataset.tag = data.tag || '';
      btnUpdate.dataset.filename = data.filename || '';
    }
  } else {
    html += '<p style="margin-top:14px;font-weight:600">' +
      _ocEsc(typeof t === 'function' ? t('oc_up_to_date') : '已是最新版本') + '</p>';
    // Still show CN download links for manual re-install convenience
    const cnLinks = (data.cn_download_links && data.cn_download_links.length > 0)
      ? data.cn_download_links
      : _OC_CN_LINKS_FALLBACK;
    html += '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">' +
      '<div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:8px">' +
      _ocEsc(typeof t === 'function' ? t('oc_cn_download_title') : '国内快速下载') + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    for (const lnk of cnLinks) {
      html += '<a href="' + _ocEsc(lnk.url) + '" target="_blank" rel="noopener noreferrer" ' +
        'style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:8px;' +
        'background:var(--surface);border:1px solid var(--border2);color:var(--text);font-size:12px;' +
        'font-weight:500;text-decoration:none;transition:background .15s" ' +
        'onmouseover="this.style.background=\'var(--border2)\'" ' +
        'onmouseout="this.style.background=\'var(--surface)\'">' +
        _ocEsc(lnk.name) + '</a>';
    }
    html += '</div></div>';
  }

  // Progress bar placeholder (hidden by default)
  html += '<div id="ocProgressWrap" style="display:none;margin-top:16px">' +
    '<div style="font-size:12px;color:var(--muted);margin-bottom:6px" id="ocProgressLabel">下载中…</div>' +
    '<div style="background:var(--border2);border-radius:6px;height:8px;overflow:hidden">' +
    '<div id="ocProgressBar" style="height:100%;width:0%;background:var(--accent);border-radius:6px;transition:width .3s"></div>' +
    '</div></div>';

  if (body) body.innerHTML = html;
}

// ── Download & install ───────────────────────────────────────────────────────

async function applyAgentMirrorUpdate() {
  const btnUpdate = document.getElementById('btnAgentMirrorUpdate');
  const tag = btnUpdate && btnUpdate.dataset.tag;
  const filename = btnUpdate && btnUpdate.dataset.filename;

  if (!tag || !filename) {
    if (typeof showToast === 'function') showToast(typeof t === 'function' ? t('oc_update_failed') : '更新信息缺失', 4000, 'error');
    return;
  }

  if (btnUpdate) { btnUpdate.disabled = true; btnUpdate.textContent = typeof t === 'function' ? t('oc_downloading') : '下载中…'; }

  try {
    const res = await api('/api/oc/update/start', { method: 'POST', body: JSON.stringify({ tag, filename }) });
    if (!res || !res.download_id) throw new Error('No download_id returned');
    _ocDownloadId = res.download_id;
    _startOcPoll();
  } catch (e) {
    if (btnUpdate) { btnUpdate.disabled = false; btnUpdate.textContent = typeof t === 'function' ? t('oc_update_btn') : '立即更新'; }
    if (typeof showToast === 'function') showToast((typeof t === 'function' ? t('oc_update_failed') : '下载启动失败') + ': ' + (e && e.message ? e.message : String(e)), 6000, 'error');
  }
}

function _startOcPoll() {
  _stopOcPoll();
  _ocPollTimer = setInterval(_pollOcDownload, 800);
}

function _stopOcPoll() {
  if (_ocPollTimer) { clearInterval(_ocPollTimer); _ocPollTimer = null; }
}

async function _pollOcDownload() {
  if (!_ocDownloadId) return;
  let data = null;
  try {
    data = await api('/api/oc/update/status?id=' + encodeURIComponent(_ocDownloadId));
  } catch (e) { return; }

  const wrap = document.getElementById('ocProgressWrap');
  const bar = document.getElementById('ocProgressBar');
  const label = document.getElementById('ocProgressLabel');
  const btnUpdate = document.getElementById('btnAgentMirrorUpdate');

  if (data.status === 'downloading' || data.status === 'starting') {
    if (wrap) wrap.style.display = 'block';
    if (bar) bar.style.width = (data.percent || 0) + '%';
    const mb = data.bytes_total ? (data.bytes_total / 1048576).toFixed(1) + ' MB' : '';
    const done = data.bytes_done ? (data.bytes_done / 1048576).toFixed(1) + ' MB' : '';
    if (label) label.textContent = (done && mb) ? done + ' / ' + mb : (typeof t === 'function' ? t('oc_downloading') : '下载中…');
  } else if (data.status === 'ready') {
    _stopOcPoll();
    if (wrap) wrap.style.display = 'none';
    if (bar) bar.style.width = '100%';
    if (btnUpdate) { btnUpdate.disabled = false; btnUpdate.style.display = 'none'; }
    _launchOcInstaller();
  } else if (data.status === 'error') {
    _stopOcPoll();
    if (wrap) wrap.style.display = 'none';
    if (btnUpdate) { btnUpdate.disabled = false; btnUpdate.textContent = typeof t === 'function' ? t('oc_update_btn') : '立即更新'; }
    if (typeof showToast === 'function') showToast((typeof t === 'function' ? t('oc_download_failed') : '下载失败') + ': ' + (data.error || ''), 6000, 'error');
  }
}

async function _launchOcInstaller() {
  try {
    const res = await api('/api/oc/update/install', { method: 'POST', body: JSON.stringify({ download_id: _ocDownloadId }) });
    if (res && res.ok) {
      if (typeof showToast === 'function') showToast(typeof t === 'function' ? t('oc_installer_launched') : '安装程序已启动，请按提示完成安装', 8000, 'success');
      closeAgentVersionModal();
    } else {
      if (typeof showToast === 'function') showToast((res && res.message) || (typeof t === 'function' ? t('oc_launch_failed') : '启动安装程序失败'), 6000, 'error');
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast((typeof t === 'function' ? t('oc_launch_failed') : '启动失败') + ': ' + (e && e.message ? e.message : String(e)), 6000, 'error');
  }
}

// ── Polling: check on startup ────────────────────────────────────────────────

(function _initOcUpdatePoll() {
  function go() {
    _checkOcUpdate();
    setInterval(_checkOcUpdate, 60 * 60 * 1000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(go, 10000));
  } else {
    setTimeout(go, 10000);
  }
})();

if (typeof window !== 'undefined') {
  window.openAgentVersionModal = openAgentVersionModal;
  window.closeAgentVersionModal = closeAgentVersionModal;
  window.applyAgentMirrorUpdate = applyAgentMirrorUpdate;
}
