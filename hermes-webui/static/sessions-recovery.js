// Self-healing watchdog for sessions.js exports.
//
// Background: in an Edge/Chromium "App Window" environment a stale cache
// can occasionally leave the page running an old sessions.js that never
// installed `window.newSession` / `window.renderSessionList`.  When that
// happens the left sidebar appears empty and the "New chat" button is
// inert, even though the server is serving a perfectly fresh build.
//
// Strategy (kept deliberately small):
//   1. After the deferred scripts have had a chance to run (DOMContentLoaded
//      + a short timer) verify that the critical session globals exist.
//   2. If they do not, perform exactly one cache-bypassing reload.  The
//      Hermes server now embeds a per-process millisecond nonce in
//      `__WEBUI_VERSION__` (see api/updates.py), so reloading from the
//      live server immediately fetches the freshest JS regardless of any
//      stale cached copy.
//   3. A sessionStorage flag prevents infinite reload loops if the freshly
//      reloaded copy is somehow still broken.
//
// We avoid the Function-constructor / eval recovery path because the
// Hermes CSP intentionally forbids `'unsafe-eval'`.  A hard reload is
// CSP-safe and observably cheaper than constructing a sandboxed scope.
const HERMES_RECOVERY_FLAG = '__hermesSessionsRecoveryReload';

function __hermesSessionsLooksReady() {
  return !!(
    typeof window !== 'undefined' &&
    window.__hermesSessionsReady &&
    typeof window.newSession === 'function' &&
    typeof window.renderSessionList === 'function'
  );
}

function __hermesTrace(event, detail) {
  if (typeof window !== 'undefined' && typeof window.traceComposerSend === 'function') {
    try { window.traceComposerSend(event, detail || {}); } catch (_) { /* best-effort */ }
  }
}

function __hermesFallbackApi(path, options) {
  if (typeof window.api === 'function') return window.api(path, options);
  const url = new URL(path.replace(/^\//, ''), document.baseURI || location.href).href;
  return fetch(url, {
    credentials: 'include',
    headers: {'Content-Type': 'application/json'},
    ...(options || {}),
  }).then(async (res) => {
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(data.error || text || `HTTP ${res.status}`);
    return data;
  });
}

function __hermesFallbackEsc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function __hermesFallbackSessionTimestamp(session) {
  return Number(session && (session.last_message_at || session.updated_at || session.created_at) || 0);
}

function __hermesGetState() {
  try {
    if (typeof S !== 'undefined' && S) return S;
  } catch (_) { /* lexical global S unavailable */ }
  return window.S || null;
}

function __hermesFallbackSetActiveUrl(sessionId) {
  try {
    if (!sessionId || !history || !history.replaceState) return;
    const base = (document.querySelector('base') && document.querySelector('base').href) || location.origin + '/';
    history.replaceState(null, '', new URL(`session/${encodeURIComponent(sessionId)}`, base).href);
  } catch (_) { /* best-effort */ }
}

function __hermesFallbackText(key, fallback) {
  const zhFallbacks = {
    session_action_pin: '置顶对话',
    session_action_pin_meta: '将此对话固定在列表顶部',
    session_action_unpin: '取消置顶',
    session_action_unpin_meta: '从置顶区域移除此对话',
    session_action_move_project: '移至项目',
    session_action_move_project_meta_new: '将此对话归属到某个项目',
    session_action_move_project_meta_change: '更改此对话所属的项目',
    session_action_archive: '归档对话',
    session_action_archive_meta: '隐藏此对话，直至在已归档中显示',
    session_action_restore: '恢复对话',
    session_action_restore_meta: '将此对话移回主列表',
    rename_title: '重命名',
    rename_prompt: '新名称:',
    renamed_to: '已重命名为 ',
    rename_failed: '重命名失败：',
    session_action_duplicate: '复制对话',
    session_action_duplicate_meta: '使用相同工作区与模型创建副本',
    session_action_delete: '删除对话',
    session_action_delete_meta: '永久移除此对话',
    session_duplicate_title_suffix: '（副本）',
    sessions_no_match: '没有匹配的对话',
    sessions_empty: '暂无对话',
    project_none: '无项目',
    project_remove_meta: '从当前项目移除此对话',
    project_move_meta: '移动到此项目',
    delete_confirm: '删除对话',
    duplicated_toast: '已复制对话',
    archived_toast: '已归档对话',
    restored_toast: '已恢复对话',
    action_title: '对话操作',
  };
  const enFallbacks = {
    session_action_pin: 'Pin conversation',
    session_action_pin_meta: 'Keep this conversation at the top',
    session_action_unpin: 'Unpin conversation',
    session_action_unpin_meta: 'Remove from the pinned section',
    session_action_move_project: 'Move to project',
    session_action_move_project_meta_new: 'Assign this conversation to a project',
    session_action_move_project_meta_change: 'Change which project this conversation belongs to',
    session_action_archive: 'Archive conversation',
    session_action_archive_meta: 'Hide this conversation until archived is shown',
    session_action_restore: 'Restore conversation',
    session_action_restore_meta: 'Move this conversation back to the main list',
    rename_title: 'Rename',
    rename_prompt: 'New name:',
    renamed_to: 'Renamed to ',
    rename_failed: 'Rename failed: ',
    session_action_duplicate: 'Duplicate conversation',
    session_action_duplicate_meta: 'Create a copy with the same workspace and model',
    session_action_delete: 'Delete conversation',
    session_action_delete_meta: 'Permanently remove this conversation',
    session_duplicate_title_suffix: ' (copy)',
    sessions_no_match: 'No matching conversations',
    sessions_empty: 'No conversations yet',
    project_none: 'No project',
    project_remove_meta: 'Remove this conversation from the current project',
    project_move_meta: 'Move to this project',
    delete_confirm: 'Delete conversation',
    duplicated_toast: 'Session duplicated',
    archived_toast: 'Session archived',
    restored_toast: 'Session restored',
    action_title: 'Conversation actions',
  };
  let lang = 'zh';
  try { lang = localStorage.getItem('hermes-lang') || document.documentElement.lang || 'zh'; } catch (_) {}
  const localFallback = String(lang).toLowerCase().startsWith('en') ? enFallbacks[key] : zhFallbacks[key];
  try {
    if (typeof t === 'function') {
      const value = t(key);
      if (value && value !== key) return value;
    }
  } catch (_) { /* lexical i18n unavailable */ }
  if (typeof window.t === 'function') {
    try {
      const value = window.t(key);
      if (value && value !== key) return value;
    } catch (_) { /* ignore */ }
  }
  return localFallback || fallback;
}

function __hermesInstallSessionsFallback() {
  if (__hermesSessionsLooksReady()) return true;
  const state = __hermesGetState();
  if (!state) {
    __hermesTrace('sessions_recovery_fallback_missing_state', {});
    return false;
  }

  let fallbackSessions = [];
  let fallbackProjects = [];
  let fallbackRenderInFlight = false;
  let fallbackListSignature = '';
  let fallbackRefreshTimer = null;
  let actionMenu = null;
  let actionAnchor = null;
  let actionSessionId = null;
  const fallbackIcons = {
    pin: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" stroke="none"><polygon points="8,1.5 9.8,5.8 14.5,6.2 11,9.4 12,14 8,11.5 4,14 5,9.4 1.5,6.2 6.2,5.8"/></svg>',
    unpin: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><polygon points="8,2 9.8,6.2 14.2,6.2 10.7,9.2 12,13.8 8,11 4,13.8 5.3,9.2 1.8,6.2 6.2,6.2"/></svg>',
    folder: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 4.5h4l1.5 1.5H14v7H2z"/></svg>',
    archive: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2" width="13" height="3" rx="1"/><path d="M2.5 5v8h11V5"/><line x1="6" y1="8.5" x2="10" y2="8.5"/></svg>',
    unarchive: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2" width="13" height="3" rx="1"/><path d="M2.5 5v8h11V5"/><polyline points="6.5,7 8,5.5 9.5,7"/></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 11.8 11.4 3.4l1.2 1.2L4.2 13H3z"/><path d="M10.6 4.2l1.2 1.2"/><path d="M2.5 14h11"/></svg>',
    refresh: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M13 5a5 5 0 0 0-8.6-2.8L3 3.6"/><path d="M3 1.4v2.2h2.2"/><path d="M3 11a5 5 0 0 0 8.6 2.8L13 12.4"/><path d="M13 14.6v-2.2h-2.2"/></svg>',
    dup: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="4.5" y="4.5" width="8.5" height="8.5" rx="1.5"/><path d="M3 11.5V3h8.5"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M4.5 4.5v8.5h7v-8.5"/><line x1="7" y1="7" x2="7" y2="11"/><line x1="9" y1="7" x2="9" y2="11"/></svg>',
    more: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" stroke="none"><circle cx="8" cy="3" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="8" cy="13" r="1.25"/></svg>',
  };

  function fallbackBuildListSignature(sessions, projects) {
    try {
      return JSON.stringify({
        sessions: (sessions || []).map((s) => [
          s.session_id,
          s.title,
          s.message_count,
          s.updated_at,
          s.last_message_at,
          s.pinned,
          s.archived,
          s.project_id,
        ]),
        projects: (projects || []).map((p) => [p.project_id, p.name]),
      });
    } catch (_) {
      return String(Date.now());
    }
  }

  async function fallbackRenderSessionList(options) {
    if (fallbackRenderInFlight) return;
    fallbackRenderInFlight = true;
    try {
      const [sessionsData, projectsData] = await Promise.all([
        __hermesFallbackApi('/api/sessions'),
        __hermesFallbackApi('/api/projects').catch(() => ({projects: []})),
      ]);
      const nextSessions = Array.isArray(sessionsData.sessions) ? sessionsData.sessions : [];
      const nextProjects = Array.isArray(projectsData.projects) ? projectsData.projects : [];
      const nextSignature = fallbackBuildListSignature(nextSessions, nextProjects);
      if (options && options.silent && nextSignature === fallbackListSignature) return;
      fallbackSessions = nextSessions;
      fallbackProjects = nextProjects;
      fallbackListSignature = nextSignature;
      fallbackRenderSessionListFromCache();
    } catch (e) {
      __hermesTrace('sessions_recovery_fallback_render_error', {error: String(e && e.message || e)});
    } finally {
      fallbackRenderInFlight = false;
    }
  }

  function closeFallbackActionMenu() {
    if (actionMenu) {
      actionMenu.remove();
      actionMenu = null;
    }
    if (actionAnchor) {
      actionAnchor.classList.remove('active');
      const row = actionAnchor.closest('.session-item');
      if (row) row.classList.remove('menu-open');
      actionAnchor = null;
    }
    actionSessionId = null;
  }

  function positionFallbackActionMenu(anchorEl) {
    if (!actionMenu || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const menuW = Math.min(280, Math.max(220, actionMenu.scrollWidth || 220));
    let left = rect.right - menuW;
    if (left < 8) left = 8;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    let top = rect.bottom + 6;
    const menuH = actionMenu.offsetHeight || 0;
    if (top + menuH > window.innerHeight - 8 && rect.top > menuH + 12) {
      top = rect.top - menuH - 6;
    }
    if (top < 8) top = 8;
    actionMenu.style.left = left + 'px';
    actionMenu.style.top = top + 'px';
  }

  function buildFallbackAction(label, meta, icon, onSelect, extraClass) {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'ws-opt session-action-opt' + (extraClass ? ` ${extraClass}` : '');
    opt.innerHTML =
      '<span class="ws-opt-action">' +
        `<span class="ws-opt-icon">${icon}</span>` +
        '<span class="session-action-copy">' +
          `<span class="ws-opt-name">${__hermesFallbackEsc(label)}</span>` +
          (meta ? `<span class="session-action-meta">${__hermesFallbackEsc(meta)}</span>` : '') +
        '</span>' +
      '</span>';
    opt.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await onSelect();
    };
    return opt;
  }

  function fallbackToast(message, kind) {
    if (typeof window.showToast === 'function') window.showToast(message, 2600, kind || 'info');
  }

  async function fallbackDeleteSession(session) {
    const ok = window.confirm(`${__hermesFallbackText('delete_confirm', '删除对话')} "${session.title || 'Untitled'}"？`);
    if (!ok) return;
    await __hermesFallbackApi('/api/session/delete', {
      method: 'POST',
      body: JSON.stringify({session_id: session.session_id}),
    });
    const currentState = __hermesGetState() || state;
    if (currentState.session && currentState.session.session_id === session.session_id) {
      currentState.session = null;
      currentState.messages = [];
      currentState.entries = [];
      try { localStorage.removeItem('hermes-webui-session'); } catch (_) {}
      if (typeof window.renderMessages === 'function') window.renderMessages();
      if (typeof window.syncTopbar === 'function') window.syncTopbar();
    }
    await fallbackRenderSessionList();
  }

  async function fallbackDuplicateSession(session) {
    const res = await __hermesFallbackApi('/api/session/new', {
      method: 'POST',
      body: JSON.stringify({
        workspace: session.workspace,
        model: session.model,
        model_provider: session.model_provider || null,
      }),
    });
    if (res.session) {
      await __hermesFallbackApi('/api/session/rename', {
        method: 'POST',
        body: JSON.stringify({
          session_id: res.session.session_id,
          title: (session.title || 'Untitled') + __hermesFallbackText('session_duplicate_title_suffix', '（副本）'),
        }),
      });
      await fallbackLoadSession(res.session.session_id);
      await fallbackRenderSessionList();
      fallbackToast(__hermesFallbackText('duplicated_toast', '已复制对话'), 'success');
    }
  }

  function showFallbackProjectPicker(session, anchorEl) {
    closeFallbackActionMenu();
    const menu = document.createElement('div');
    menu.className = 'session-action-menu open';
    menu.appendChild(buildFallbackAction(
      __hermesFallbackText('project_none', '无项目'),
      __hermesFallbackText('project_remove_meta', '从当前项目移除此对话'),
      fallbackIcons.folder,
      async () => {
        closeFallbackActionMenu();
        await __hermesFallbackApi('/api/session/move', {
          method: 'POST',
          body: JSON.stringify({session_id: session.session_id, project_id: null}),
        });
        await fallbackRenderSessionList();
      }
    ));
    for (const project of fallbackProjects) {
      menu.appendChild(buildFallbackAction(
        project.name || 'Project',
        __hermesFallbackText('project_move_meta', '移动到此项目'),
        fallbackIcons.folder,
        async () => {
          closeFallbackActionMenu();
          await __hermesFallbackApi('/api/session/move', {
            method: 'POST',
            body: JSON.stringify({session_id: session.session_id, project_id: project.project_id}),
          });
          await fallbackRenderSessionList();
        }
      ));
    }
    document.body.appendChild(menu);
    actionMenu = menu;
    actionAnchor = anchorEl;
    actionSessionId = session.session_id;
    anchorEl.classList.add('active');
    const row = anchorEl.closest('.session-item');
    if (row) row.classList.add('menu-open');
    positionFallbackActionMenu(anchorEl);
  }

  function openFallbackActionMenu(session, anchorEl) {
    if (actionMenu && actionSessionId === session.session_id && actionAnchor === anchorEl) {
      closeFallbackActionMenu();
      return;
    }
    closeFallbackActionMenu();
    const menu = document.createElement('div');
    menu.className = 'session-action-menu open';
    menu.appendChild(buildFallbackAction(
      session.pinned ? __hermesFallbackText('session_action_unpin', '取消置顶') : __hermesFallbackText('session_action_pin', '置顶对话'),
      session.pinned ? __hermesFallbackText('session_action_unpin_meta', '从置顶区域移除此对话') : __hermesFallbackText('session_action_pin_meta', '将此对话固定在列表顶部'),
      session.pinned ? fallbackIcons.pin : fallbackIcons.unpin,
      async () => {
        closeFallbackActionMenu();
        const nextPinned = !session.pinned;
        await __hermesFallbackApi('/api/session/pin', {
          method: 'POST',
          body: JSON.stringify({session_id: session.session_id, pinned: nextPinned}),
        });
        session.pinned = nextPinned;
        await fallbackRenderSessionList();
      },
      session.pinned ? 'is-active' : ''
    ));
    menu.appendChild(buildFallbackAction(
      __hermesFallbackText('session_action_move_project', '移至项目'),
      session.project_id ? __hermesFallbackText('session_action_move_project_meta_change', '更改此对话所属的项目') : __hermesFallbackText('session_action_move_project_meta_new', '将此对话归属到某个项目'),
      fallbackIcons.folder,
      async () => showFallbackProjectPicker(session, anchorEl)
    ));
    menu.appendChild(buildFallbackAction(
      session.archived ? __hermesFallbackText('session_action_restore', '恢复对话') : __hermesFallbackText('session_action_archive', '归档对话'),
      session.archived ? __hermesFallbackText('session_action_restore_meta', '将此对话移回主列表') : __hermesFallbackText('session_action_archive_meta', '隐藏此对话，直至在已归档中显示'),
      session.archived ? fallbackIcons.unarchive : fallbackIcons.archive,
      async () => {
        closeFallbackActionMenu();
        await __hermesFallbackApi('/api/session/archive', {
          method: 'POST',
          body: JSON.stringify({session_id: session.session_id, archived: !session.archived}),
        });
        await fallbackRenderSessionList();
        fallbackToast(session.archived ? __hermesFallbackText('restored_toast', '已恢复对话') : __hermesFallbackText('archived_toast', '已归档对话'), 'success');
      }
    ));
    menu.appendChild(buildFallbackAction(
      __hermesFallbackText('rename_title', '重命名'),
      '',
      fallbackIcons.edit,
      async () => {
        closeFallbackActionMenu();
        const oldTitle = String(session.title || 'Untitled').trim();
        const nextTitle = window.prompt(__hermesFallbackText('rename_prompt', '新名称:'), oldTitle);
        if (nextTitle === null) return;
        const trimmed = nextTitle.trim() || 'Untitled';
        if (trimmed === oldTitle) return;
        try {
          const res = await __hermesFallbackApi('/api/session/rename', {
            method: 'POST',
            body: JSON.stringify({session_id: session.session_id, title: trimmed}),
          });
          if (res && res.session) session.title = res.session.title;
          await fallbackRenderSessionList();
          fallbackToast(__hermesFallbackText('renamed_to', '已重命名为 ') + (session.title || trimmed), 'success');
        } catch (err) {
          fallbackToast(__hermesFallbackText('rename_failed', '重命名失败：') + (err && err.message || ''), 'error');
        }
      }
    ));
    menu.appendChild(buildFallbackAction(
      __hermesFallbackText('session_action_duplicate', '复制对话'),
      __hermesFallbackText('session_action_duplicate_meta', '使用相同工作区与模型创建副本'),
      fallbackIcons.dup,
      async () => {
        closeFallbackActionMenu();
        await fallbackDuplicateSession(session);
      }
    ));
    menu.appendChild(buildFallbackAction(
      __hermesFallbackText('session_action_delete', '删除对话'),
      __hermesFallbackText('session_action_delete_meta', '永久移除此对话'),
      fallbackIcons.trash,
      async () => {
        closeFallbackActionMenu();
        await fallbackDeleteSession(session);
      },
      'danger'
    ));
    document.body.appendChild(menu);
    actionMenu = menu;
    actionAnchor = anchorEl;
    actionSessionId = session.session_id;
    anchorEl.classList.add('active');
    const row = anchorEl.closest('.session-item');
    if (row) row.classList.add('menu-open');
    positionFallbackActionMenu(anchorEl);
  }

  function fallbackRenderSessionListFromCache() {
    const list = document.getElementById('sessionList');
    if (!list) return;
    const q = (document.getElementById('sessionSearch') && document.getElementById('sessionSearch').value || '').toLowerCase().trim();
    const currentState = __hermesGetState() || state;
    const activeId = currentState.session && currentState.session.session_id;
    const sessions = fallbackSessions
      .filter((s) => s && !s.archived)
      .filter((s) => Number(s.message_count || 0) > 0 || s.session_id === activeId)
      .filter((s) => !q || String(s.title || 'Untitled').toLowerCase().includes(q))
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return __hermesFallbackSessionTimestamp(b) - __hermesFallbackSessionTimestamp(a);
      });

    closeFallbackActionMenu();
    list.innerHTML = '';
    if (!sessions.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:18px 14px;color:var(--muted);font-size:12px;text-align:center;opacity:.75;';
      empty.textContent = q
        ? __hermesFallbackText('sessions_no_match', '没有匹配的对话')
        : __hermesFallbackText('sessions_empty', '暂无对话');
      list.appendChild(empty);
      return;
    }

    for (const session of sessions) {
      const row = document.createElement('div');
      row.className = 'session-item' + (session.session_id === activeId ? ' active' : '');
      row.dataset.sessionId = session.session_id;
      row.innerHTML =
        '<div class="session-text">' +
          '<div class="session-title-row">' +
            `<span class="session-title">${__hermesFallbackEsc(session.title || 'Untitled')}</span>` +
          '</div>' +
          `<div class="session-meta">${__hermesFallbackEsc(session.workspace || '')}</div>` +
        '</div>' +
        '<div class="session-actions">' +
          `<button type="button" class="session-actions-trigger" title="${__hermesFallbackEsc(__hermesFallbackText('action_title', '对话操作'))}" aria-haspopup="menu" aria-label="${__hermesFallbackEsc(__hermesFallbackText('action_title', '对话操作'))}">` +
            fallbackIcons.more +
          '</button>' +
        '</div>';
      row.onclick = () => fallbackLoadSession(session.session_id);
      const menuBtn = row.querySelector('.session-actions-trigger');
      if (menuBtn) {
        menuBtn.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          openFallbackActionMenu(session, menuBtn);
        };
      }
      list.appendChild(row);
    }
  }

  async function fallbackNewSession() {
    const modelSelect = document.getElementById('modelSelect');
    const currentState = __hermesGetState() || state;
    const switchWorkspace = currentState._profileSwitchWorkspace;
    currentState._profileSwitchWorkspace = null;
    const workspace = switchWorkspace || (currentState.session && currentState.session.workspace) || currentState._profileDefaultWorkspace || null;
    const payload = {
      workspace,
      model: (window._defaultModel || (modelSelect && modelSelect.value) || ''),
      model_provider: window._activeProvider || null,
      profile: currentState.activeProfile || 'default',
    };
    const data = await __hermesFallbackApi('/api/session/new', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    currentState.session = data.session;
    currentState.messages = (data.session && data.session.messages) || [];
    currentState.entries = [];
    currentState.busy = false;
    currentState.activeStreamId = null;
    try { localStorage.setItem('hermes-webui-session', currentState.session.session_id); } catch (_) {}
    __hermesFallbackSetActiveUrl(currentState.session.session_id);
    if (typeof window.renderMessages === 'function') window.renderMessages();
    if (typeof window.syncTopbar === 'function') window.syncTopbar();
    if (typeof window.updateSendBtn === 'function') window.updateSendBtn();
    if (typeof window.loadDir === 'function') window.loadDir('.');
    await fallbackRenderSessionList();
    return data;
  }

  async function fallbackLoadSession(sessionId) {
    if (!sessionId) return;
    const currentState = __hermesGetState() || state;
    const data = await __hermesFallbackApi(`/api/session?session_id=${encodeURIComponent(sessionId)}&messages=1&resolve_model=0`);
    currentState.session = data.session;
    currentState.messages = (data.session && data.session.messages) || [];
    currentState.entries = [];
    currentState.busy = false;
    currentState.activeStreamId = null;
    try { localStorage.setItem('hermes-webui-session', sessionId); } catch (_) {}
    __hermesFallbackSetActiveUrl(sessionId);
    if (typeof window.renderMessages === 'function') window.renderMessages();
    if (typeof window.syncTopbar === 'function') window.syncTopbar();
    if (typeof window.updateSendBtn === 'function') window.updateSendBtn();
    fallbackRenderSessionListFromCache();
  }

  window.newSession = fallbackNewSession;
  window.loadSession = fallbackLoadSession;
  window.renderSessionList = fallbackRenderSessionList;
  window.renderSessionListFromCache = fallbackRenderSessionListFromCache;
  window.filterSessions = fallbackRenderSessionListFromCache;
  window.startGatewaySSE = window.startGatewaySSE || function(){};
  window.stopGatewaySSE = window.stopGatewaySSE || function(){};
  window.__hermesSessionsReady = true;

  const search = document.getElementById('sessionSearch');
  if (search) search.oninput = fallbackRenderSessionListFromCache;
  document.addEventListener('click', (event) => {
    if (actionMenu && !actionMenu.contains(event.target) && actionAnchor && !actionAnchor.contains(event.target)) {
      closeFallbackActionMenu();
    }
  });
  window.addEventListener('resize', () => {
    if (actionMenu && actionAnchor) positionFallbackActionMenu(actionAnchor);
  });

  const btn = document.getElementById('btnNewChat');
  if (btn) {
    btn.onclick = async () => {
      await fallbackNewSession();
      const msg = document.getElementById('msg');
      if (msg) msg.focus();
    };
  }

  fallbackRefreshTimer = window.setInterval(() => {
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    void fallbackRenderSessionList({silent: true});
  }, 3000);
  window.addEventListener('beforeunload', () => {
    if (fallbackRefreshTimer) window.clearInterval(fallbackRefreshTimer);
  }, {once: true});

  void fallbackRenderSessionList();
  __hermesTrace('sessions_recovery_fallback_installed', {});
  return true;
}

async function __ensureHermesSessions() {
  if (__hermesSessionsLooksReady()) return true;

  // Give other deferred scripts a tick or two -- DOMContentLoaded fires
  // before all `defer` scripts have actually executed in some browser
  // versions.  Two ticks is empirically enough without noticeably
  // delaying real users.
  await new Promise((resolve) => setTimeout(resolve, 60));
  if (__hermesSessionsLooksReady()) return true;
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (__hermesSessionsLooksReady()) return true;

  let alreadyReloaded = false;
  try {
    alreadyReloaded = sessionStorage.getItem(HERMES_RECOVERY_FLAG) === '1';
  } catch (_) { /* sessionStorage may be unavailable in embedded views */ }

  __hermesTrace('sessions_recovery_start', {
    ready: !!window.__hermesSessionsReady,
    has_new_session: typeof window.newSession === 'function',
    has_render: typeof window.renderSessionList === 'function',
    already_reloaded: alreadyReloaded,
  });

  if (alreadyReloaded) {
    __hermesTrace('sessions_recovery_giveup', {
      reason: 'second_failure_after_reload',
    });
    return __hermesInstallSessionsFallback();
  }

  // Try the local fallback immediately. If it succeeds, the user gets a usable
  // sidebar without a disruptive reload. If it cannot install because core UI
  // state is not available yet, fall back to the one-shot reload path.
  if (__hermesInstallSessionsFallback()) return true;

  try { sessionStorage.setItem(HERMES_RECOVERY_FLAG, '1'); } catch (_) { /* ignore */ }
  __hermesTrace('sessions_recovery_reload', { url: location.href });
  try {
    location.reload();
  } catch (_) { /* navigation failure -- nothing else we can do */ }
  return false;
}

if (typeof window !== 'undefined') {
  window.__ensureHermesSessions = __ensureHermesSessions;

  // Once the page has confirmed-good sessions globals, clear the recovery
  // flag so future legitimate restarts get one fresh reload attempt.
  const _maybeClearRecoveryFlag = () => {
    if (__hermesSessionsLooksReady()) {
      try { sessionStorage.removeItem(HERMES_RECOVERY_FLAG); } catch (_) { /* ignore */ }
    }
  };

  const _kick = () => {
    setTimeout(() => {
      void __ensureHermesSessions().then(_maybeClearRecoveryFlag);
    }, 0);
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', _kick, { once: true });
  } else {
    _kick();
  }
}
