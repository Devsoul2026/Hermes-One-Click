const CONNECT_APP_GROUP_ORDER = [
  'top_picks',
  'international_im',
  'china_workplace_wechat',
  'open_interfaces',
  'traditional_channels',
  'others',
];

const CONNECT_APP_GROUP_LABELS = {
  top_picks: () => t('connect_app_group_top_picks'),
  international_im: () => t('connect_app_group_international_im'),
  china_workplace_wechat: () => t('connect_app_group_china_workplace_wechat'),
  open_interfaces: () => t('connect_app_group_open_interfaces'),
  traditional_channels: () => t('connect_app_group_traditional_channels'),
  others: () => t('connect_app_group_others'),
};

const CONNECT_APP_STATE = {
  platforms: [],
  activeKey: null,
  activeConfig: null,
  pendingWeixinCredentials: null,
  weixinPollTimer: null,
  weixinPollState: null,
};

const CONNECT_APP_FALLBACK_PLATFORMS = [
  { key: 'telegram', display_name: 'Telegram', group: 'top_picks', subtitle_zh: 'Bot Token + Chat ID', subtitle_en: 'Bot Token + Chat ID', status: 'not_configured' },
  { key: 'discord', display_name: 'Discord', group: 'top_picks', subtitle_zh: 'Bot Token + Channel', subtitle_en: 'Bot Token + Channel', status: 'not_configured' },
  { key: 'slack', display_name: 'Slack', group: 'top_picks', subtitle_zh: 'Bot/User Token + Channel', subtitle_en: 'Bot/User Token + Channel', status: 'not_configured' },
  { key: 'feishu', display_name: 'Feishu', group: 'china_workplace_wechat', subtitle_zh: '应用凭证 + 事件订阅', subtitle_en: 'App credentials + event subscription', status: 'not_configured' },
  { key: 'dingtalk', display_name: 'DingTalk', group: 'china_workplace_wechat', subtitle_zh: '机器人 Webhook / 企业应用', subtitle_en: 'Bot webhook / enterprise app', status: 'not_configured' },
  { key: 'wecom', display_name: 'WeCom', group: 'china_workplace_wechat', subtitle_zh: '企业微信应用配置', subtitle_en: 'WeCom app configuration', status: 'not_configured' },
  { key: 'weixin', display_name: 'WeChat', group: 'china_workplace_wechat', subtitle_zh: '扫码接入 / 开放平台能力', subtitle_en: 'QR-based onboarding / open platform capability', status: 'not_configured' },
  { key: 'qqbot', display_name: 'QQ Bot', group: 'china_workplace_wechat', subtitle_zh: 'QQ 官方 Bot API', subtitle_en: 'QQ official Bot API', status: 'not_configured' },
  { key: 'webhook', display_name: 'Webhook', group: 'open_interfaces', subtitle_zh: 'HTTP 回调入口', subtitle_en: 'HTTP callback endpoint', status: 'not_configured' },
  { key: 'email', display_name: 'Email', group: 'traditional_channels', subtitle_zh: 'SMTP/IMAP 通道', subtitle_en: 'SMTP/IMAP channel', status: 'not_configured' },
  { key: 'sms', display_name: 'SMS', group: 'traditional_channels', subtitle_zh: '短信网关配置', subtitle_en: 'SMS gateway configuration', status: 'not_configured' },
];

function connectAppStatusLabel(status){
  if(status === 'connected') return t('connect_app_status_connected');
  if(status === 'error') return t('connect_app_status_error');
  if(status === 'configured') return t('connect_app_status_configured');
  return t('connect_app_status_not_configured');
}

function connectAppStatusClass(status){
  if(status === 'connected') return 'connected';
  if(status === 'error') return 'error';
  if(status === 'configured') return 'configured';
  return 'not-configured';
}

async function loadConnectApps(){
  const list = $('connectAppList');
  if(!list) return;
  list.innerHTML = `<div style="padding:12px;color:var(--muted);font-size:12px">${esc(t('loading'))}</div>`;
  try{
    const data = await api('/api/connect-app/platforms');
    CONNECT_APP_STATE.platforms = Array.isArray(data.platforms) ? data.platforms : [];
    if(!CONNECT_APP_STATE.platforms.length){
      CONNECT_APP_STATE.platforms = CONNECT_APP_FALLBACK_PLATFORMS.slice();
    }
    renderConnectAppCards();
    filterConnectAppCards();
  }catch(e){
    CONNECT_APP_STATE.platforms = CONNECT_APP_FALLBACK_PLATFORMS.slice();
    renderConnectAppCards();
    filterConnectAppCards();
    showToast(`${t('error_prefix')}${e.message || ''}`, 3000);
  }
}

function renderConnectAppCards(){
  const list = $('connectAppList');
  if(!list) return;
  const grouped = {};
  for(const item of CONNECT_APP_STATE.platforms){
    const g = item.group || 'others';
    if(!grouped[g]) grouped[g] = [];
    grouped[g].push(item);
  }
  const parts = [];
  for(const group of CONNECT_APP_GROUP_ORDER){
    const items = grouped[group] || [];
    if(!items.length) continue;
    const groupLabel = (CONNECT_APP_GROUP_LABELS[group] || (() => group))();
    parts.push(`<div class="connect-app-group" data-group="${esc(group)}">`);
    parts.push(`<div class="connect-app-group-title">${esc(groupLabel)}</div>`);
    for(const item of items){
      const subtitle = (String((localStorage.getItem('hermes-lang') || 'zh')).toLowerCase().startsWith('zh'))
        ? (item.subtitle_zh || '')
        : (item.subtitle_en || item.subtitle_zh || '');
      parts.push(`
        <div class="connect-app-card" data-key="${esc(item.key)}" data-name="${esc((item.display_name || '').toLowerCase())}" data-status="${esc(item.status || 'not_configured')}">
          <div class="connect-app-card-head">
            <div>
              <div class="connect-app-card-title">${esc(item.display_name || item.key)}</div>
              ${subtitle ? `<div class="connect-app-card-subtitle">${esc(subtitle)}</div>` : ''}
            </div>
            <span class="connect-app-status ${connectAppStatusClass(item.status)}">${esc(connectAppStatusLabel(item.status))}</span>
          </div>
          <div class="connect-app-card-actions">
            <button type="button" class="cron-btn run" onclick="openConnectAppConfig('${esc(item.key)}')">${esc(t('connect_app_configure'))}</button>
            <button type="button" class="cron-btn" onclick="testConnectApp('${esc(item.key)}')">${esc(t('connect_app_test_connection'))}</button>
            <button type="button" class="cron-btn" onclick="disableConnectApp('${esc(item.key)}')">${esc(t('connect_app_disable'))}</button>
          </div>
        </div>
      `);
    }
    parts.push(`</div>`);
  }
  list.innerHTML = parts.join('');
}

function filterConnectAppCards(){
  const queryEl = $('connectAppSearch');
  const query = queryEl ? String(queryEl.value || '').trim().toLowerCase() : '';
  const status = $('connectAppStatusFilter')?.value || 'all';
  document.querySelectorAll('#connectAppList .connect-app-card').forEach((card) => {
    const name = card.getAttribute('data-name') || '';
    const cardStatus = card.getAttribute('data-status') || '';
    const qOk = !query || name.includes(query);
    const sOk = status === 'all' || status === cardStatus;
    card.style.display = (qOk && sOk) ? '' : 'none';
  });
}

function _configGetValue(cfg, path){
  const parts = String(path).split('.');
  let cur = cfg;
  for(const p of parts){
    if(!cur || typeof cur !== 'object') return '';
    cur = cur[p];
  }
  if(cur == null) return '';
  if(typeof cur === 'boolean') return cur ? 'true' : 'false';
  if(typeof cur === 'object') return JSON.stringify(cur);
  return String(cur);
}

function connectAppFieldRow(path, value, required, schema){
  const labels = schema?.field_labels || {};
  const widgets = schema?.field_widgets || {};
  const label = labels[path] || path;
  const w = widgets[path];
  if(w && w.type === 'select'){
    const opts = (w.options || []).map((o) => {
      const sel = String(value) === String(o.value) ? ' selected' : '';
      return `<option value="${esc(o.value)}"${sel}>${esc(o.label)}</option>`;
    }).join('');
    return `
    <label class="connect-app-field">
      <span>${esc(label)}${required ? ' *' : ''}</span>
      <select data-path="${esc(path)}">${opts}</select>
    </label>`;
  }
  return `
    <label class="connect-app-field">
      <span>${esc(label)}${required ? ' *' : ''}</span>
      <input type="text" data-path="${esc(path)}" value="${esc(value || '')}" ${required ? 'required' : ''}>
    </label>
  `;
}

function _buildWeixinQrSection(){
  return `
    <div class="connect-weixin-qr">
      <p class="connect-weixin-hint">${esc(t('connect_app_weixin_qr_intro'))}</p>
      <button type="button" class="cron-btn run" onclick="startWeixinQrFlow()">${esc(t('connect_app_weixin_get_qr'))}</button>
      <div id="weixinQrBlock" class="connect-weixin-qr-block" style="display:none">
        <img id="weixinQrImg" class="connect-weixin-qr-img" alt="" width="200" height="200"/>
        <div class="connect-weixin-link-wrap"><a id="weixinQrOpenLink" href="#" target="_blank" rel="noopener">${esc(t('connect_app_weixin_open_link'))}</a></div>
        <div id="weixinQrStatus" class="connect-weixin-qr-status"></div>
      </div>
    </div>`;
}

function clearWeixinPoll(){
  if(CONNECT_APP_STATE.weixinPollTimer){
    clearInterval(CONNECT_APP_STATE.weixinPollTimer);
    CONNECT_APP_STATE.weixinPollTimer = null;
  }
  CONNECT_APP_STATE.weixinPollState = null;
}

async function startWeixinQrFlow(){
  clearWeixinPoll();
  CONNECT_APP_STATE.pendingWeixinCredentials = null;
  const statusEl = $('weixinQrStatus');
  const block = $('weixinQrBlock');
  const img = $('weixinQrImg');
  const link = $('weixinQrOpenLink');
  if(statusEl) statusEl.textContent = t('connect_app_weixin_requesting');
  try{
    const data = await api('/api/connect-app/platforms/weixin/qr/start', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if(block) block.style.display = '';
    const scanUrl = data.scan_url || data.qrcode_url || data.qrcode_img_content || '';
    const qrSrc = data.qr_image
      || (data.qr_png_base64 ? `data:image/png;base64,${data.qr_png_base64}` : '')
      || (scanUrl && /^(https?:|data:image\/)/i.test(scanUrl) ? scanUrl : '');
    if(qrSrc && img){
      img.onload = () => { img.style.display = ''; };
      img.onerror = () => {
        img.removeAttribute('src');
        img.style.display = 'none';
        if(statusEl) statusEl.textContent = `${t('connect_app_weixin_status_wait')} ${t('connect_app_weixin_open_link')}`;
      };
      img.src = qrSrc;
      img.style.display = '';
    }else if(img){
      img.removeAttribute('src');
      img.style.display = 'none';
    }
    if(link && scanUrl){
      link.href = scanUrl;
      link.style.display = '';
    }else if(link){
      link.removeAttribute('href');
      link.style.display = 'none';
    }
    CONNECT_APP_STATE.weixinPollState = {
      qrcode: data.qrcode,
      base_url: data.poll_base_url || '',
    };
    if(statusEl) statusEl.textContent = t('connect_app_weixin_status_wait');
    CONNECT_APP_STATE.weixinPollTimer = setInterval(() => { pollWeixinQrOnce(); }, 2000);
    await pollWeixinQrOnce();
  }catch(e){
    if(statusEl) statusEl.textContent = '';
    showToast(`${t('error_prefix')}${e.message || ''}`, 5000);
  }
}

async function pollWeixinQrOnce(){
  const w = CONNECT_APP_STATE.weixinPollState;
  if(!w || !w.qrcode) return;
  const statusEl = $('weixinQrStatus');
  try{
    const r = await api('/api/connect-app/platforms/weixin/qr/poll', {
      method: 'POST',
      body: JSON.stringify({ qrcode: w.qrcode, base_url: w.base_url || '' }),
    });
    if(r.poll_base_url){
      w.base_url = r.poll_base_url;
    }
    if(r.qr_image || r.qr_png_base64 || r.scan_url){
      const img = $('weixinQrImg');
      const link = $('weixinQrOpenLink');
      const scanUrl = r.scan_url || r.qrcode_url || '';
      const qrSrc = r.qr_image
        || (r.qr_png_base64 ? `data:image/png;base64,${r.qr_png_base64}` : '')
        || (scanUrl && /^(https?:|data:image\/)/i.test(scanUrl) ? scanUrl : '');
      if(qrSrc && img){
        img.onload = () => { img.style.display = ''; };
        img.onerror = () => {
          img.removeAttribute('src');
          img.style.display = 'none';
        };
        img.src = qrSrc;
        img.style.display = '';
      }
      if(scanUrl && link){
        link.href = scanUrl;
        link.style.display = '';
      }
    }
    const st = r.status || 'wait';
    if(st === 'wait' && statusEl) statusEl.textContent = t('connect_app_weixin_status_wait');
    if(st === 'scaned' && statusEl) statusEl.textContent = t('connect_app_weixin_status_scaned');
    if(st === 'scaned_but_redirect' && statusEl) statusEl.textContent = t('connect_app_weixin_status_redirect');
    if(st === 'expired'){
      clearWeixinPoll();
      if(statusEl) statusEl.textContent = t('connect_app_weixin_status_expired');
      showToast(t('connect_app_weixin_status_expired'), 4000);
    }
    if(st === 'confirmed'){
      clearWeixinPoll();
      CONNECT_APP_STATE.pendingWeixinCredentials = r.credentials || null;
      if(statusEl) statusEl.textContent = t('connect_app_weixin_status_confirmed');
      showToast(t('connect_app_weixin_ready_save'), 5000);
    }
  }catch(e){
    clearWeixinPoll();
    if(statusEl) statusEl.textContent = '';
    showToast(`${t('error_prefix')}${e.message || ''}`, 5000);
  }
}

function _renderGenericConnectForm(data){
  const schema = data.schema || {};
  const required = schema.required || [];
  const optional = schema.optional || [];
  const advanced = schema.advanced || [];
  const cfg = data.config || {};
  const getValue = (path) => _configGetValue(cfg, path);
  return `
    <div class="connect-app-config-sheet">
      <div class="connect-app-config-section-title">${esc(t('connect_app_required'))}</div>
      ${required.map((f) => connectAppFieldRow(f, getValue(f), true, schema)).join('')}
      <div class="connect-app-config-section-title">${esc(t('connect_app_optional'))}</div>
      ${optional.map((f) => connectAppFieldRow(f, getValue(f), false, schema)).join('')}
      <details class="connect-app-advanced">
        <summary>${esc(t('connect_app_advanced'))}</summary>
        ${advanced.map((f) => connectAppFieldRow(f, getValue(f), false, schema)).join('')}
      </details>
    </div>
  `;
}

function _renderWeixinConnectForm(data){
  const schema = data.schema || {};
  const optional = schema.optional || [];
  const advanced = schema.advanced || [];
  const cfg = data.config || {};
  const getValue = (path) => _configGetValue(cfg, path);
  return `
    <div class="connect-app-config-sheet">
      ${_buildWeixinQrSection()}
      <div class="connect-app-config-section-title">${esc(t('connect_app_optional'))}</div>
      ${optional.map((f) => connectAppFieldRow(f, getValue(f), false, schema)).join('')}
      <details class="connect-app-advanced">
        <summary>${esc(t('connect_app_advanced'))}</summary>
        ${advanced.map((f) => connectAppFieldRow(f, getValue(f), false, schema)).join('')}
      </details>
    </div>
  `;
}

async function openConnectAppConfig(key){
  try{
    const data = await api(`/api/connect-app/platforms/${encodeURIComponent(key)}`);
    CONNECT_APP_STATE.activeKey = key;
    CONNECT_APP_STATE.activeConfig = data;
    CONNECT_APP_STATE.pendingWeixinCredentials = null;
    clearWeixinPoll();
    const body = (data.connect_ui && data.connect_ui.mode === 'weixin_qr')
      ? _renderWeixinConnectForm(data)
      : _renderGenericConnectForm(data);
    const drawerTitle = $('connectAppDrawerTitle');
    const drawerBody = $('connectAppDrawerBody');
    const drawer = $('connectAppDrawer');
    if(drawerTitle) drawerTitle.textContent = data.display_name || key;
    if(drawerBody) drawerBody.innerHTML = body;
    if(drawer) drawer.classList.add('open');
  }catch(e){
    showToast(`${t('error_prefix')}${e.message || ''}`, 4000);
  }
}

function closeConnectAppDrawer(){
  clearWeixinPoll();
  CONNECT_APP_STATE.pendingWeixinCredentials = null;
  const drawer = $('connectAppDrawer');
  if(drawer) drawer.classList.remove('open');
}

function _coerceFieldValue(path, raw){
  const v = String(raw || '').trim();
  if(v === '') return '';
  if(path === 'enabled' || path.endsWith('.enabled')) return v === 'true';
  if(v.startsWith('{') || v.startsWith('[')){
    try{ return JSON.parse(v); }catch(_e){ return v; }
  }
  if(v === 'true') return true;
  if(v === 'false') return false;
  return v;
}

function _deepMerge(dst, src){
  if(!src || typeof src !== 'object') return dst;
  for(const k of Object.keys(src)){
    const sv = src[k];
    if(sv && typeof sv === 'object' && !Array.isArray(sv)){
      if(!dst[k] || typeof dst[k] !== 'object') dst[k] = {};
      _deepMerge(dst[k], sv);
    }else{
      dst[k] = sv;
    }
  }
  return dst;
}

async function saveConnectAppConfig(){
  const key = CONNECT_APP_STATE.activeKey;
  if(!key) return;
  const config = {};
  if(key === 'weixin' && CONNECT_APP_STATE.pendingWeixinCredentials){
    _deepMerge(config, CONNECT_APP_STATE.pendingWeixinCredentials);
  }
  document.querySelectorAll('#connectAppDrawer .connect-app-field input[data-path], #connectAppDrawer .connect-app-field select[data-path]').forEach((el) => {
    const path = el.getAttribute('data-path');
    const value = _coerceFieldValue(path, el.value);
    if(!path || value === '') return;
    const parts = path.split('.');
    let cur = config;
    for(let i = 0; i < parts.length - 1; i++){
      const p = parts[i];
      if(!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
  });
  const res = await api(`/api/connect-app/platforms/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled: true, config }),
  });
  showToast(t('connect_app_saved_enabled'));
  const gr = res && res.gateway_restart;
  if(gr){
    if(gr.restarted){
      showToast(t('platforms_saved_restart_ok'), 4500);
    }else if(gr.started){
      showToast(gr.pending ? t('gateway_start_pending') : t('gateway_start_ok'), 6000);
    }else if(gr.reason === 'not_running'){
      showToast(t('connect_app_gateway_start_needed'), 5000);
    }
  }
  if(typeof restartDesktopGatewayIfRunning === 'function'){
    try{
      const result = await restartDesktopGatewayIfRunning();
      if(result && result.restarted){
        showToast(t('platforms_saved_restart_ok'), 4000);
      }
    }catch(_e){ /* optional desktop bridge */ }
  }
  closeConnectAppDrawer();
  await loadConnectApps();
}

async function testConnectApp(key){
  if(!key) return;
  try{
    const res = await api(`/api/connect-app/platforms/${encodeURIComponent(key)}/test`, {
      method: 'POST',
      body: JSON.stringify({ dry_run: true }),
    });
    if(res.ok){
      showToast(t('connect_app_test_success'));
    }else{
      showToast(res.message || t('connect_app_test_failed_kept'), 5000);
    }
    await loadConnectApps();
  }catch(e){
    showToast(`${t('error_prefix')}${e.message || ''}`, 5000);
  }
}

async function disableConnectApp(key){
  if(!key) return;
  try{
    await api(`/api/connect-app/platforms/${encodeURIComponent(key)}/disable`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    showToast(t('connect_app_disabled'));
    await loadConnectApps();
  }catch(e){
    showToast(`${t('error_prefix')}${e.message || ''}`, 4000);
  }
}
