/* Hermes agent version vs domestic Git mirror — modal + periodic notify */

async function _agentMirrorStatusFetchQuiet() {
  try {
    const href = new URL('api/agent/mirror-status', document.baseURI || location.href).href;
    const res = await fetch(href, { credentials: 'include' });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    return res.json();
  } catch (_) {
    return null;
  }
}

function _agentEsc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function _syncTitlebarAgentSemver(data) {
  const el = document.getElementById('titlebarAgentSemver');
  if (!el) return;
  if (data && data.ok && data.agent_found && data.package_version) {
    el.textContent = ' \u00b7 ' + data.package_version;
    el.removeAttribute('hidden');
    el.setAttribute('aria-hidden', 'false');
  } else {
    el.textContent = '';
    el.setAttribute('hidden', 'hidden');
    el.setAttribute('aria-hidden', 'true');
  }
}

function _agentVersionPackageRow(pv) {
  if (!pv) return '';
  return (
    '<div class="agent-version-row agent-version-package"><strong>' +
    _agentEsc(t('agent_version_release_label')) +
    '</strong> <code>' +
    _agentEsc(pv) +
    '</code></div>'
  );
}

function _fillAgentVersionModal(data) {
  const body = typeof $ === 'function' ? $('agentVersionBody') : null;
  const status = typeof $ === 'function' ? $('agentVersionStatus') : null;
  const btnUp = typeof $ === 'function' ? $('btnAgentMirrorUpdate') : null;
  const titleBtn = document.getElementById('btnViewAgentVersion');
  if (status) status.textContent = '';
  if (!body) return;
  if (!data || !data.ok) {
    const msg = data && data.error ? data.error : 'unknown';
    body.innerHTML = '<p>' + _agentEsc(t('agent_version_error').replace('{msg}', msg)) + '</p>';
    if (btnUp) btnUp.style.display = 'none';
    if (titleBtn) titleBtn.classList.remove('has-update');
    _syncTitlebarAgentSemver(null);
    return;
  }
  let html = '';
  if (!data.agent_found) {
    html = '<p>' + _agentEsc(t('agent_version_no_agent')) + '</p>';
    if (btnUp) btnUp.style.display = 'none';
    if (titleBtn) titleBtn.classList.remove('has-update');
  } else if (data.git_repo === false) {
    html = _agentVersionPackageRow(data.package_version);
    html +=
      '<div class="agent-version-row"><strong>' +
      _agentEsc(t('agent_version_local_label')) +
      '</strong> <code>' +
      _agentEsc(data.local_version || '') +
      '</code></div>';
    html += '<p style="margin-top:12px">' + _agentEsc(t('agent_version_no_git')) + '</p>';
    if (btnUp) btnUp.style.display = 'none';
  } else {
    const localLabel = data.package_version ? t('agent_version_git_label') : t('agent_version_local_label');
    html = _agentVersionPackageRow(data.package_version);
    html +=
      '<div class="agent-version-row"><strong>' +
      _agentEsc(localLabel) +
      '</strong> <code>' +
      _agentEsc(data.local_version || '') +
      '</code> <span>(' +
      _agentEsc(data.local_sha || '') +
      ')</span></div>';
    html +=
      '<div class="agent-version-row"><strong>' +
      _agentEsc(t('agent_version_mirror_label')) +
      '</strong> <code>' +
      _agentEsc(data.mirror_short || '') +
      '</code></div>';
    html +=
      '<div class="agent-version-row"><strong>' +
      _agentEsc(t('agent_version_branch')) +
      '</strong> ' +
      _agentEsc(data.mirror_branch || '') +
      '</div>';
    html +=
      '<div class="agent-version-row"><strong>' +
      _agentEsc(t('agent_version_path')) +
      '</strong> <span class="agent-version-mirror-url">' +
      _agentEsc(data.agent_path || '') +
      '</span></div>';
    html +=
      '<div class="agent-version-row"><strong>' +
      _agentEsc(t('agent_version_mirror_url_label')) +
      '</strong> <span class="agent-version-mirror-url">' +
      _agentEsc(data.mirror_url || '') +
      '</span></div>';
    if (data.mirror_url_primary && data.mirror_url_primary !== data.mirror_url) {
      html +=
        '<p style="margin-top:8px;font-size:11px;color:var(--muted)">' +
        _agentEsc(t('agent_version_mirror_fallback_note')) +
        ' <span class="agent-version-mirror-url">' +
        _agentEsc(data.mirror_url_primary) +
        '</span></p>';
    }
    if (data.fetch_ok === false && data.fetch_error) {
      html +=
        '<p style="margin-top:10px;font-size:12px">' +
        _agentEsc(String(data.fetch_error).slice(0, 220)) +
        '</p>';
    }
    let state = '';
    if (data.update_available) {
      state =
        data.behind > 0
          ? t('agent_version_behind').replace('{n}', String(data.behind))
          : t('agent_version_maybe_behind');
      if (titleBtn) titleBtn.classList.add('has-update');
      if (btnUp) btnUp.style.display = 'inline-flex';
    } else {
      state = t('agent_version_synced');
      if (titleBtn) titleBtn.classList.remove('has-update');
      if (btnUp) btnUp.style.display = 'none';
    }
    html +=
      '<p style="margin-top:14px;color:var(--text);font-weight:600">' + _agentEsc(state) + '</p>';
  }
  body.innerHTML = html;
  _syncTitlebarAgentSemver(data);
}

function openAgentVersionModal() {
  const modal = typeof $ === 'function' ? $('agentVersionModal') : null;
  if (!modal) return;
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  if (typeof applyLocaleToDOM === 'function') applyLocaleToDOM();
  refreshAgentVersionModal();
}

function closeAgentVersionModal() {
  const modal = typeof $ === 'function' ? $('agentVersionModal') : null;
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
}

async function refreshAgentVersionModal() {
  const status = typeof $ === 'function' ? $('agentVersionStatus') : null;
  if (status) status.textContent = t('agent_version_loading');
  try {
    const data = await api('/api/agent/mirror-status');
    _fillAgentVersionModal(data);
  } catch (e) {
    const body = typeof $ === 'function' ? $('agentVersionBody') : null;
    if (body) {
      body.innerHTML =
        '<p>' +
        _agentEsc(
          t('agent_version_error').replace('{msg}', e && e.message ? e.message : String(e)),
        ) +
        '</p>';
    }
    _syncTitlebarAgentSemver(null);
  } finally {
    if (status) status.textContent = '';
  }
}

async function applyAgentMirrorUpdate() {
  const ok = await showConfirmDialog({
    title: t('agent_version_update_confirm_title'),
    message: t('agent_version_update_confirm_message'),
    confirmLabel: t('agent_version_update_btn'),
    danger: false,
    focusCancel: true,
  });
  if (!ok) return;
  const btn = typeof $ === 'function' ? $('btnAgentMirrorUpdate') : null;
  if (btn) btn.disabled = true;
  try {
    const res = await api('/api/agent/mirror-update', { method: 'POST', body: JSON.stringify({}) });
    if (res && res.ok) {
      showToast(res.message || t('agent_version_update_started'), 3800, 'success');
      if (typeof _waitForServerThenReload === 'function') {
        await _waitForServerThenReload();
      } else {
        location.reload();
      }
    } else {
      showToast((res && res.message) || t('agent_version_update_failed'), 5000, 'error');
    }
  } catch (e) {
    showToast(t('agent_version_update_failed') + (e && e.message ? ' ' + e.message : ''), 5000, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _pollAgentMirrorBadge() {
  _agentMirrorStatusFetchQuiet().then((data) => {
    if (!data || !data.ok) return;
    const tip = data.mirror_sha || '';
    const prev = localStorage.getItem('hermes-mirror-toast-tip');
    if (data.update_available && tip && prev !== tip) {
      localStorage.setItem('hermes-mirror-toast-tip', tip);
      if (typeof showToast === 'function') {
        showToast(t('agent_toast_new_version'), 8000, 'warning');
      }
    }
    const b = document.getElementById('btnViewAgentVersion');
    if (!b) return;
    if (data.update_available) b.classList.add('has-update');
    else b.classList.remove('has-update');
    _syncTitlebarAgentSemver(data);
  });
}

(function _initAgentMirrorPoll() {
  function go() {
    _pollAgentMirrorBadge();
    setInterval(_pollAgentMirrorBadge, 60 * 60 * 1000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(go, 12000));
  } else {
    setTimeout(go, 12000);
  }
})();

if (typeof window !== 'undefined') {
  window.openAgentVersionModal = openAgentVersionModal;
  window.closeAgentVersionModal = closeAgentVersionModal;
  window.refreshAgentVersionModal = refreshAgentVersionModal;
  window.applyAgentMirrorUpdate = applyAgentMirrorUpdate;
}
