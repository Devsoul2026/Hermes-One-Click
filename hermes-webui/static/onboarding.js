const ONBOARDING={status:null,step:0,steps:['system','setup','workspace','password','finish'],form:{provider:'openrouter',workspace:'',model:'',password:'',apiKey:'',baseUrl:''},active:false,liveModelChoices:null,workspaceLiveModelsAttempted:false};

function _getOnboardingSetupProviders(){
  return (((ONBOARDING.status||{}).setup||{}).providers)||[];
}

function _getOnboardingSetupProvider(id){
  return _getOnboardingSetupProviders().find(p=>p.id===id)||null;
}

function _getOnboardingSetupCategories(){
  return (((ONBOARDING.status||{}).setup||{}).categories)||[];
}

/** Render the provider <select> with <optgroup> per category. */
function _renderProviderSelectOptions(selectedId){
  const providers=_getOnboardingSetupProviders();
  const categories=_getOnboardingSetupCategories();
  const provMap={};
  providers.forEach(p=>{provMap[p.id]=p;});
  if(!categories.length){
    // Fallback: flat list when no categories are available.
    return providers.map(p=>`<option value="${esc(p.id)}">${esc(p.label)}${p.quick?' — '+esc(t('onboarding_quick_setup_badge')):''}</option>`).join('');
  }
  return categories.map(cat=>{
    const opts=cat.providers.map(pid=>{
      const p=provMap[pid];
      if(!p)return '';
      return `<option value="${esc(p.id)}"${p.id===selectedId?' selected':''}>${esc(p.label)}${p.quick?' — '+esc(t('onboarding_quick_setup_badge')):''}</option>`;
    }).join('');
    return `<optgroup label="${esc(t('provider_category_'+cat.id)||cat.label)}">${opts}</optgroup>`;
  }).join('');
}

function _getOnboardingCurrentSetup(){
  return (((ONBOARDING.status||{}).setup||{}).current)||{};
}

function _onboardingStepMeta(key){
  return ({
    system:{title:t('onboarding_step_system_title'),desc:t('onboarding_step_system_desc')},
    setup:{title:t('onboarding_step_setup_title'),desc:t('onboarding_step_setup_desc')},
    workspace:{title:t('onboarding_step_workspace_title'),desc:t('onboarding_step_workspace_desc')},
    password:{title:t('onboarding_step_password_title'),desc:t('onboarding_step_password_desc')},
    finish:{title:t('onboarding_step_finish_title'),desc:t('onboarding_step_finish_desc')}
  })[key];
}

function _renderOnboardingSteps(){
  const wrap=$('onboardingSteps');
  if(!wrap)return;
  wrap.innerHTML='';
  ONBOARDING.steps.forEach((key,idx)=>{
    const meta=_onboardingStepMeta(key);
    const item=document.createElement('div');
    item.className='onboarding-step'+(idx===ONBOARDING.step?' active':idx<ONBOARDING.step?' done':'');
    item.innerHTML=`<div class="onboarding-step-index">${idx+1}</div><div><div class="onboarding-step-title">${meta.title}</div><div class="onboarding-step-desc">${meta.desc}</div></div>`;
    wrap.appendChild(item);
  });
}

function _setOnboardingNotice(msg,kind='info'){
  const el=$('onboardingNotice');
  if(!el)return;
  if(!msg){el.style.display='none';el.textContent='';el.className='onboarding-status';return;}
  el.style.display='block';
  el.className='onboarding-status '+kind;
  el.textContent=msg;
}

function _getOnboardingWorkspaceChoices(){
  const items=((ONBOARDING.status||{}).workspaces||{}).items||[];
  return items.length?items:[{name:'Home',path:ONBOARDING.form.workspace||''}];
}

function _getOnboardingProviderModelChoices(){
  const pid=String(ONBOARDING.form.provider||'').trim();
  if(ONBOARDING.liveModelChoices&&ONBOARDING.liveModelChoices.provider===pid&&(ONBOARDING.liveModelChoices.models||[]).length){
    return ONBOARDING.liveModelChoices.models;
  }
  const provider=_getOnboardingSetupProvider(pid);
  return provider?(provider.models||[]):[];
}

function _getOnboardingSelectedModel(){
  return ONBOARDING.form.model||'';
}

function _normOnboardingUrl(u){
  return String(u||'').trim().replace(/\/+$/,'');
}

function _onboardingShowBaseUrlField(provider){
  if(!provider) return false;
  if(provider.requires_base_url) return true;
  return !!(provider.default_base_url && String(provider.default_base_url).trim());
}

function _onboardingBaseUrlInputValue(provider){
  if(!provider) return '';
  const cur=(ONBOARDING.form.baseUrl||'').trim();
  if(cur) return cur;
  return String(provider.default_base_url||'').trim();
}

function onboardingApplyBaseUrlPreset(url){
  const v=String(url||'').trim();
  ONBOARDING.form.baseUrl=v;
  const inp=$('onboardingBaseUrlInput');
  if(inp) inp.value=v;
}

function _onboardingHtmlBaseUrlSection(provider){
  if(!_onboardingShowBaseUrlField(provider)) return '';
  const val=esc(_onboardingBaseUrlInputValue(provider));
  const presets=provider.base_url_presets||[];
  let presetBlock='';
  if(presets.length){
    const cur=_normOnboardingUrl(_onboardingBaseUrlInputValue(provider));
    const opts=presets.map(pr=>{
      const u=String(pr.url||'').trim();
      const sel=_normOnboardingUrl(u)===cur?' selected':'';
      const lab=t(pr.label_key)||pr.label||u;
      return `<option value="${esc(u)}"${sel}>${esc(lab)}</option>`;
    }).join('');
    presetBlock=`<label class="onboarding-field"><span>${t('onboarding_base_url_preset_label')}</span><select id="onboardingBaseUrlPreset" onchange="onboardingApplyBaseUrlPreset(this.value)">${opts}</select></label>`;
  }
  const inputBlock=`<label class="onboarding-field"><span>${t('onboarding_base_url_label')}</span><input id="onboardingBaseUrlInput" value="${val}" placeholder="${t('onboarding_base_url_placeholder')}" oninput="ONBOARDING.form.baseUrl=this.value"></label>`;
  const genericHelp=`<p class="onboarding-copy">${t('onboarding_base_url_help')}</p>`;
  const deepHint=(provider.id==='deepseek')?`<p class="onboarding-copy">${t('onboarding_deepseek_base_url_hint')}</p>`:'';
  return presetBlock+inputBlock+genericHelp+deepHint;
}

function _isOnboardingWorkspaceStep(){
  return !!(ONBOARDING.active&&ONBOARDING.steps[ONBOARDING.step]==='workspace');
}

function _renderOnboardingModelField(){
  const choices=_getOnboardingProviderModelChoices();
  const has=Array.isArray(choices)&&choices.length>0;
  const onWs=_isOnboardingWorkspaceStep();
  if(ONBOARDING.form.provider==='custom'&&!has){
    return `<label class="onboarding-field"><span>${t('onboarding_model_label')}</span><input id="onboardingModelInput" value="${esc(_getOnboardingSelectedModel())}" placeholder="${t('onboarding_custom_model_placeholder')}" oninput="ONBOARDING.form.model=this.value"></label><p class="onboarding-copy">${t('onboarding_custom_model_help')}</p>`;
  }
  if(onWs&&!has&&ONBOARDING.workspaceLiveModelsAttempted){
    return `<label class="onboarding-field"><span>${t('onboarding_model_label')}</span><input id="onboardingModelInput" value="${esc(_getOnboardingSelectedModel())}" placeholder="${t('onboarding_custom_model_placeholder')}" oninput="ONBOARDING.form.model=this.value"></label><p class="onboarding-copy">${t('onboarding_workspace_model_manual_hint')}</p>`;
  }
  if(onWs&&!has){
    return `<label class="onboarding-field"><span>${t('onboarding_model_label')}</span><select id="onboardingModelSelect" aria-busy="true" disabled><option value="">${esc(t('onboarding_models_fetching'))}</option></select></label><p class="onboarding-copy">${t('onboarding_workspace_help')}</p>`;
  }
  const options=(choices||[]).map(m=>`<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
  return `<label class="onboarding-field"><span>${t('onboarding_model_label')}</span><select id="onboardingModelSelect" onchange="ONBOARDING.form.model=this.value">${options}</select></label><p class="onboarding-copy">${t('onboarding_workspace_help')}</p>`;
}

function _providerStatusLabel(system){
  if(system.chat_ready) return t('onboarding_check_provider_ready');
  if(system.provider_configured) return t('onboarding_check_provider_partial');
  return t('onboarding_check_provider_pending');
}

function _onboardingResolvedLang(){
  try{
    const raw=(typeof localStorage!=='undefined'&&localStorage.getItem('hermes-lang'))||'';
    if(typeof resolveLocale==='function') return resolveLocale(raw)||'zh';
  }catch(e){}
  return 'zh';
}

function _syncOnboardingLangToggle(){
  const row=$('onboardingLangRow');
  if(!row) return;
  const show=ONBOARDING.active && ONBOARDING.step===0;
  row.style.display=show?'flex':'none';
  const zh=$('onboardingLangZh');
  const en=$('onboardingLangEn');
  const key=_onboardingResolvedLang();
  const isEn=key==='en';
  if(zh){
    zh.classList.toggle('active',!isEn);
    zh.setAttribute('aria-pressed',(!isEn).toString());
  }
  if(en){
    en.classList.toggle('active',isEn);
    en.setAttribute('aria-pressed',(isEn).toString());
  }
}

function setOnboardingLocale(code){
  const lang=(code==='en')?'en':'zh';
  if(typeof setLocale==='function') setLocale(lang);
  if(typeof applyLocaleToDOM==='function') applyLocaleToDOM();
  _renderOnboardingSteps();
  _renderOnboardingBody();
}

function _renderOnboardingBody(){
  const body=$('onboardingBody');
  if(!body||!ONBOARDING.status)return;
  _syncOnboardingLangToggle();
  const key=ONBOARDING.steps[ONBOARDING.step];
  if(key!=='workspace'&&typeof closeOnboardingWorkspaceBrowse==='function') closeOnboardingWorkspaceBrowse();
  const system=ONBOARDING.status.system||{};
  const settings=ONBOARDING.status.settings||{};
  const setup=ONBOARDING.status.setup||{};
  const nextBtn=$('onboardingNextBtn');
  const backBtn=$('onboardingBackBtn');
  if(backBtn) backBtn.style.display=ONBOARDING.step>0?'':'none';
  if(nextBtn) nextBtn.textContent=key==='finish'?t('onboarding_open'):t('onboarding_continue');

  if(key==='system'){
    const hermesOk=system.hermes_found&&system.imports_ok;
    const setupOk=!!system.chat_ready;
    _setOnboardingNotice(system.provider_note|| (setupOk?t('onboarding_notice_system_ready'):t('onboarding_notice_system_unavailable')),setupOk?'success':(hermesOk?'info':'warn'));
    body.innerHTML=`
      <div class="onboarding-panel-grid">
        <div class="onboarding-check ${hermesOk?'ok':'warn'}"><strong>${t('onboarding_check_agent')}</strong><span>${hermesOk?t('onboarding_check_agent_ready'):t('onboarding_check_agent_missing')}</span></div>
        <div class="onboarding-check ${(setupOk?'ok':system.provider_configured?'warn':'muted')}"><strong>${t('onboarding_check_provider')}</strong><span>${_providerStatusLabel(system)}</span></div>
        <div class="onboarding-check ${(settings.password_enabled?'ok':'muted')}"><strong>${t('onboarding_check_password')}</strong><span>${settings.password_enabled?t('onboarding_check_password_enabled'):t('onboarding_check_password_disabled')}</span></div>
      </div>
      <div class="onboarding-copy">
        <p><strong>${t('onboarding_config_file')}</strong> ${esc(system.config_path||t('onboarding_unknown'))}</p>
        <p><strong>${t('onboarding_env_file')}</strong> ${esc(system.env_path||t('onboarding_unknown'))}</p>
        <p>${esc(system.provider_note||'')}</p>
        ${system.current_provider?`<p><strong>${t('onboarding_current_provider')}</strong> ${esc(system.current_provider)}${system.current_model?` — ${esc(system.current_model)}`:''}</p>`:''}
        ${system.current_base_url?`<p><strong>${t('onboarding_base_url_label')}</strong> ${esc(system.current_base_url)}</p>`:''}
        ${system.missing_modules&&system.missing_modules.length?`<p><strong>${t('onboarding_missing_imports')}</strong> ${esc(system.missing_modules.join(', '))}</p>`:''}
      </div>`;
    return;
  }

  if(key==='setup'){
    ONBOARDING.liveModelChoices=null;
    const selectedId=ONBOARDING.form.provider;
    const groupedOptions=_renderProviderSelectOptions(selectedId);
    const provider=_getOnboardingSetupProvider(selectedId)||_getOnboardingSetupProviders()[0]||null;
    const keyHelp=provider?`${t('onboarding_api_key_help_prefix')} ${esc(provider.env_var)}.`:'';

    // OAuth provider path: configured via CLI, no API key input needed.
    const currentIsOauth=!!(ONBOARDING.status.setup||{}).current_is_oauth;
    const currentProviderName=((ONBOARDING.status.setup||{}).current||{}).provider||'';
    if(currentIsOauth){
      const isReady=!!(ONBOARDING.status.system||{}).chat_ready;
      const providerLabel=esc(currentProviderName);
      if(isReady){
        _setOnboardingNotice(t('onboarding_notice_setup_already_ready'),'success');
        body.innerHTML=`
          <div class="onboarding-oauth-card onboarding-oauth-ready">
            <div class="onboarding-oauth-icon">✓</div>
            <div>
              <strong>${t('onboarding_oauth_provider_ready_title')}</strong>
              <p>${t('onboarding_oauth_provider_ready_body').replace('{provider}',providerLabel)}</p>
            </div>
          </div>
          <p class="onboarding-copy" style="margin-top:20px">${t('onboarding_oauth_switch_hint')}</p>
          <label class="onboarding-field">
            <span>${t('onboarding_provider_label')}</span>
            <select id="onboardingProviderSelect" onchange="syncOnboardingProvider(this.value)">${groupedOptions}</select>
          </label>
          <label class="onboarding-field" id="onboardingApiKeyField">
            <span>${t('onboarding_api_key_label')}</span>
            <input id="onboardingApiKeyInput" type="password" value="${esc(ONBOARDING.form.apiKey||'')}" placeholder="${t('onboarding_api_key_placeholder')}" oninput="ONBOARDING.form.apiKey=this.value">
          </label>
          ${_onboardingHtmlBaseUrlSection(provider)}
          <p class="onboarding-copy">${keyHelp}</p>`;
      } else {
        _setOnboardingNotice(t('onboarding_notice_setup_required'),'warn');
        body.innerHTML=`
          <div class="onboarding-oauth-card onboarding-oauth-pending">
            <div class="onboarding-oauth-icon">⚠</div>
            <div>
              <strong>${t('onboarding_oauth_provider_not_ready_title')}</strong>
              <p>${t('onboarding_oauth_provider_not_ready_body').replace('{provider}',providerLabel)}</p>
            </div>
          </div>
          <p class="onboarding-copy" style="margin-top:20px">${t('onboarding_oauth_switch_hint')}</p>
          <label class="onboarding-field">
            <span>${t('onboarding_provider_label')}</span>
            <select id="onboardingProviderSelect" onchange="syncOnboardingProvider(this.value)">${groupedOptions}</select>
          </label>
          <label class="onboarding-field" id="onboardingApiKeyField">
            <span>${t('onboarding_api_key_label')}</span>
            <input id="onboardingApiKeyInput" type="password" value="${esc(ONBOARDING.form.apiKey||'')}" placeholder="${t('onboarding_api_key_placeholder')}" oninput="ONBOARDING.form.apiKey=this.value">
          </label>
          ${_onboardingHtmlBaseUrlSection(provider)}
          <p class="onboarding-copy">${keyHelp}</p>`;
      }
      return;
    }

    _setOnboardingNotice(system.chat_ready?t('onboarding_notice_setup_already_ready'):t('onboarding_notice_setup_required'),system.chat_ready?'success':'info');
    body.innerHTML=`
      <label class="onboarding-field">
        <span>${t('onboarding_provider_label')}</span>
        <select id="onboardingProviderSelect" onchange="syncOnboardingProvider(this.value)">${groupedOptions}</select>
      </label>
      <label class="onboarding-field">
        <span>${t('onboarding_api_key_label')}</span>
        <input id="onboardingApiKeyInput" type="password" value="${esc(ONBOARDING.form.apiKey||'')}" placeholder="${t('onboarding_api_key_placeholder')}" oninput="ONBOARDING.form.apiKey=this.value">
      </label>
      ${_onboardingHtmlBaseUrlSection(provider)}
      <p class="onboarding-copy">${keyHelp}</p>
      <div class="onboarding-oauth-card" id="codexOAuthCard">
        <div class="onboarding-oauth-icon">🔑</div>
        <div style="flex:1">
          <strong>${t('oauth_login_codex')}</strong>
          <p style="margin:6px 0 0;font-size:13px;color:var(--muted);line-height:1.5">
            ${t('onboarding_oauth_switch_hint')}
          </p>
        </div>
        <button class="sm-btn" id="codexOAuthBtn" onclick="startCodexOAuth()" style="margin-left:auto;flex-shrink:0">${t('oauth_login_codex')}</button>
      </div>
      <div id="codexOAuthFlow" style="display:none;margin-top:12px"></div>
      <p class="onboarding-copy">${esc(setup.unsupported_note||'')||''}</p>`;
    return;
  }

  if(key==='workspace'){
    ONBOARDING.workspaceLiveModelsAttempted=false;
    const workspaceOptions=_getOnboardingWorkspaceChoices().map(ws=>`<option value="${esc(ws.path)}">${esc(ws.name||ws.path)} — ${esc(ws.path)}</option>`).join('');
    _setOnboardingNotice(t('onboarding_notice_workspace'), 'info');
    body.innerHTML=`
      <label class="onboarding-field">
        <span>${t('onboarding_workspace_label')}</span>
        <select id="onboardingWorkspaceSelect" onchange="syncOnboardingWorkspaceSelect(this.value)">${workspaceOptions}</select>
      </label>
      <label class="onboarding-field onboarding-workspace-path-row">
        <span>${t('onboarding_workspace_or_path')}</span>
        <div class="onboarding-workspace-path-inner">
          <input id="onboardingWorkspaceInput" value="${esc(ONBOARDING.form.workspace||'')}" placeholder="${t('onboarding_workspace_placeholder')}" oninput="ONBOARDING.form.workspace=this.value">
          <button type="button" class="onboarding-workspace-browse-btn" onclick="openOnboardingWorkspaceBrowse()">${esc(t('onboarding_workspace_browse'))}</button>
        </div>
      </label>
      <div id="onboardingModelFieldSlot">${_renderOnboardingModelField()}</div>`;
    const wsSel=$('onboardingWorkspaceSelect');
    if(wsSel && ONBOARDING.form.workspace) wsSel.value=ONBOARDING.form.workspace;
    _bindOnboardingModelFieldValue();
    setTimeout(()=>{void _loadOnboardingLiveModelsForWorkspace();},0);
    return;
  }

  if(key==='password'){
    _setOnboardingNotice(settings.password_enabled?t('onboarding_notice_password_enabled'):t('onboarding_notice_password_recommended'), settings.password_enabled?'success':'info');
    body.innerHTML=`
      <label class="onboarding-field">
        <span>${t('onboarding_password_label')}</span>
        <input id="onboardingPasswordInput" type="password" value="${esc(ONBOARDING.form.password||'')}" placeholder="${t('onboarding_password_placeholder')}" oninput="ONBOARDING.form.password=this.value">
      </label>
      <p class="onboarding-copy">${t('onboarding_password_help')}</p>`;
    return;
  }

  const provider=_getOnboardingSetupProvider(ONBOARDING.form.provider);
  _setOnboardingNotice(t('onboarding_notice_finish'), 'success');
  body.innerHTML=`
    <div class="onboarding-summary">
      <div><strong>${t('onboarding_provider_label')}</strong><span>${esc((provider&&provider.label)||ONBOARDING.form.provider||t('onboarding_not_set'))}</span></div>
      <div><strong>${t('onboarding_model_label')}</strong><span>${esc(_getOnboardingSelectedModel()||t('onboarding_not_set'))}</span></div>
      <div><strong>${t('onboarding_workspace_label')}</strong><span>${esc(ONBOARDING.form.workspace||t('onboarding_not_set'))}</span></div>
      <div><strong>${t('onboarding_check_password')}</strong><span>${t(_getOnboardingPasswordSummaryKey(settings))}</span></div>
    </div>
    ${ONBOARDING.form.baseUrl?`<p class="onboarding-copy"><strong>${t('onboarding_base_url_label')}</strong> ${esc(ONBOARDING.form.baseUrl)}</p>`:''}
    <p class="onboarding-copy">${t('onboarding_finish_help')}</p>`;
}

function _getOnboardingPasswordSummaryKey(settings){
  const hasExistingPassword=!!(settings&&settings.password_enabled);
  const hasNewPassword=!!((ONBOARDING.form.password||'').trim());
  if(hasNewPassword) return hasExistingPassword?'onboarding_password_will_replace':'onboarding_password_will_enable';
  return hasExistingPassword?'onboarding_password_keep_existing':'onboarding_password_remains_disabled';
}

function syncOnboardingWorkspaceSelect(value){
  ONBOARDING.form.workspace=value;
  const input=$('onboardingWorkspaceInput');
  if(input) input.value=value;
}

let _onboardingWsBrowseParent=null;

function _onboardingWsSuggestQueryPrefix(dir){
  if(dir==null||dir==='') return '';
  return String(dir).replace(/\\/g,'/').replace(/\/+$/,'') + '/';
}

function _onboardingWsBrowseParentPath(current){
  if(current==null||current==='') return null;
  let norm=String(current).replace(/\\/g,'/').replace(/\/+$/,'');
  const idx=norm.lastIndexOf('/');
  if(idx<0) return null;
  let parent=norm.slice(0,idx);
  if(/^[a-zA-Z]:$/.test(parent)) parent=parent+'/';
  return parent;
}

function _ensureOnboardingWorkspaceBrowseModal(){
  let modal=$('onboardingWsBrowseModal');
  if(modal) return modal;
  const overlay=$('onboardingOverlay');
  if(!overlay) return null;
  modal=document.createElement('div');
  modal.id='onboardingWsBrowseModal';
  modal.className='onboarding-ws-browse-modal';
  modal.setAttribute('role','dialog');
  modal.setAttribute('aria-modal','true');
  modal.innerHTML=`
    <div class="onboarding-ws-browse-dialog" onclick="event.stopPropagation()">
      <h3 id="onboardingWsBrowseTitle">${esc(t('onboarding_workspace_browse_title'))}</h3>
      <p class="onboarding-ws-browse-hint" id="onboardingWsBrowseHint">${esc(t('onboarding_workspace_browse_hint'))}</p>
      <div class="onboarding-ws-browse-toolbar">
        <code id="onboardingWsBrowseCurrent">—</code>
        <button type="button" class="sm-btn" id="onboardingWsBrowseUp">${esc(t('onboarding_workspace_browse_up'))}</button>
      </div>
      <div class="onboarding-ws-browse-list" id="onboardingWsBrowseList"></div>
      <div class="onboarding-ws-browse-actions">
        <button type="button" class="sm-btn" id="onboardingWsBrowseCancel">${esc(t('cancel'))}</button>
        <button type="button" class="sm-btn" id="onboardingWsBrowseUse" style="font-weight:700;color:var(--blue);border-color:rgba(124,185,255,.32)">${esc(t('onboarding_workspace_browse_use'))}</button>
      </div>
    </div>`;
  modal.addEventListener('click',()=>closeOnboardingWorkspaceBrowse());
  overlay.appendChild(modal);
  $('onboardingWsBrowseUp').onclick=(e)=>{e.stopPropagation();void _onboardingWsBrowseGoUp();};
  $('onboardingWsBrowseCancel').onclick=(e)=>{e.stopPropagation();closeOnboardingWorkspaceBrowse();};
  $('onboardingWsBrowseUse').onclick=(e)=>{e.stopPropagation();_onboardingWsBrowseConfirm();};
  return modal;
}

function closeOnboardingWorkspaceBrowse(){
  const modal=$('onboardingWsBrowseModal');
  if(modal) modal.classList.remove('open');
}

async function openOnboardingWorkspaceBrowse(){
  try{
    const init=String(ONBOARDING.form.workspace||'').trim();
    const r=await api('/api/system/pick-folder',{method:'POST',body:JSON.stringify({initial_dir:init})});
    if(r&&r.ok===true&&typeof r.path==='string'&&r.path.trim()){
      _applyOnboardingWorkspacePath(r.path.trim());
      return;
    }
    if(r&&r.cancelled===true) return;
    if(r&&r.ok===false&&r.message&&(r.error==='picker_failed'||r.error==='validation_failed')){
      _setOnboardingNotice(r.message,'warn');
    }
  }catch(e){
    console.warn('native pick-folder',e);
  }
  _openOnboardingWorkspaceServerBrowseModal();
}

function _openOnboardingWorkspaceServerBrowseModal(){
  const modal=_ensureOnboardingWorkspaceBrowseModal();
  if(!modal) return;
  const seed=String(ONBOARDING.form.workspace||'').trim();
  _onboardingWsBrowseParent=seed||null;
  modal.classList.add('open');
  void _onboardingWsBrowseRefresh();
}

function _onboardingWsBrowseGoUp(){
  const up=_onboardingWsBrowseParentPath(_onboardingWsBrowseParent||'');
  _onboardingWsBrowseParent=up;
  void _onboardingWsBrowseRefresh();
}

function _onboardingWsBrowseConfirm(){
  if(_onboardingWsBrowseParent==null||_onboardingWsBrowseParent===''){
    closeOnboardingWorkspaceBrowse();
    return;
  }
  _applyOnboardingWorkspacePath(_onboardingWsBrowseParent);
  closeOnboardingWorkspaceBrowse();
}

function _applyOnboardingWorkspacePath(absPath){
  const p=String(absPath||'').trim();
  if(!p) return;
  ONBOARDING.form.workspace=p;
  const inp=$('onboardingWorkspaceInput');
  if(inp) inp.value=p;
  const sel=$('onboardingWorkspaceSelect');
  if(sel){
    let found=false;
    for(let i=0;i<sel.options.length;i++){
      if(sel.options[i].value===p){sel.selectedIndex=i;found=true;break;}
    }
    if(!found){
      const o=document.createElement('option');
      o.value=p;
      o.textContent=p.length>72?p.slice(0,72)+'…':p;
      sel.appendChild(o);
      sel.value=p;
    }
  }
}

function _onboardingWsBrowseRowLabel(fullPath){
  const s=String(fullPath||'');
  const parts=s.split(/[/\\]/).filter(Boolean);
  if(!parts.length) return {leaf:s,parent:''};
  const leaf=parts[parts.length-1];
  const parent=parts.length>1?parts.slice(0,-1).join('/'):'';
  return {leaf,parent};
}

async function _onboardingWsBrowseRefresh(){
  const listEl=$('onboardingWsBrowseList');
  const curEl=$('onboardingWsBrowseCurrent');
  const upBtn=$('onboardingWsBrowseUp');
  const useBtn=$('onboardingWsBrowseUse');
  if(!listEl||!curEl) return;
  const prefix=_onboardingWsSuggestQueryPrefix(_onboardingWsBrowseParent||'');
  curEl.textContent=_onboardingWsBrowseParent||t('onboarding_workspace_browse_roots');
  if(upBtn) upBtn.disabled=_onboardingWsBrowseParent==null||_onboardingWsBrowseParent==='';
  if(useBtn) useBtn.disabled=_onboardingWsBrowseParent==null||_onboardingWsBrowseParent==='';
  listEl.innerHTML=`<div class="onboarding-ws-browse-empty">${esc(t('onboarding_workspace_browse_loading'))}</div>`;
  try{
    const q=prefix?`prefix=${encodeURIComponent(prefix)}&`:'';
    const data=await api(`/api/workspaces/suggest?${q}limit=200`);
    const paths=(data&&data.suggestions)||[];
    if(!paths.length){
      listEl.innerHTML=`<div class="onboarding-ws-browse-empty">${esc(t('onboarding_workspace_browse_empty'))}</div>`;
      return;
    }
    listEl.innerHTML=paths.map(full=>{
      const {leaf,parent}=_onboardingWsBrowseRowLabel(full);
      return `<button type="button" class="onboarding-ws-browse-item" data-path="${esc(full)}"><span class="leaf">${esc(leaf)}</span>${parent?`<span class="sub">${esc(parent)}</span>`:''}</button>`;
    }).join('');
    listEl.querySelectorAll('.onboarding-ws-browse-item').forEach(btn=>{
      btn.onclick=(e)=>{
        e.stopPropagation();
        const p=btn.getAttribute('data-path');
        if(!p) return;
        _onboardingWsBrowseParent=p;
        void _onboardingWsBrowseRefresh();
      };
    });
  }catch(e){
    listEl.innerHTML=`<div class="onboarding-ws-browse-empty">${esc(t('onboarding_workspace_browse_load_failed'))}</div>`;
  }
}

function _bindOnboardingModelFieldValue(){
  const modelSel=$('onboardingModelSelect');
  if(modelSel && ONBOARDING.form.model) modelSel.value=ONBOARDING.form.model;
  const modelInp=$('onboardingModelInput');
  if(modelInp && ONBOARDING.form.model) modelInp.value=ONBOARDING.form.model;
}

async function _loadOnboardingLiveModelsForWorkspace(){
  const pid=String(ONBOARDING.form.provider||'').trim();
  const slot=$('onboardingModelFieldSlot');
  if(!pid||!slot) return;
  const prevNotice=t('onboarding_notice_workspace');
  _setOnboardingNotice(t('onboarding_models_fetching'),'info');
  try{
    const data=await api('/api/models/live?provider='+encodeURIComponent(pid));
    const err=data&&data.error;
    const list=(data&&data.models)||[];
    ONBOARDING.workspaceLiveModelsAttempted=true;
    if(err||!list.length){
      ONBOARDING.liveModelChoices=null;
      slot.innerHTML=_renderOnboardingModelField();
      _bindOnboardingModelFieldValue();
      _setOnboardingNotice(err?`${prevNotice} — ${t('onboarding_models_live_failed')}`:prevNotice,err?'warn':'info');
      return;
    }
    const cur=String(ONBOARDING.form.model||'').trim();
    if(!list.some(m=>m.id===cur)) ONBOARDING.form.model=list[0].id;
    ONBOARDING.liveModelChoices={provider:pid,models:list};
    slot.innerHTML=_renderOnboardingModelField();
    _bindOnboardingModelFieldValue();
    _setOnboardingNotice(prevNotice,'info');
  }catch(e){
    ONBOARDING.workspaceLiveModelsAttempted=true;
    ONBOARDING.liveModelChoices=null;
    slot.innerHTML=_renderOnboardingModelField();
    _bindOnboardingModelFieldValue();
    _setOnboardingNotice(`${prevNotice} — ${t('onboarding_models_live_failed')}`,'warn');
  }
}

function syncOnboardingProvider(value){
  ONBOARDING.liveModelChoices=null;
  const provider=_getOnboardingSetupProvider(value);
  ONBOARDING.form.provider=value;
  if(provider){
    const choices=_getOnboardingProviderModelChoices();
    const hasChoices=Array.isArray(choices)&&choices.length>0;
    if(!ONBOARDING.form.model || (hasChoices&&!choices.some(m=>m.id===ONBOARDING.form.model))){
      ONBOARDING.form.model=provider.default_model||'';
    }
    if(provider.requires_base_url){
      ONBOARDING.form.baseUrl=ONBOARDING.form.baseUrl||provider.default_base_url||'';
    }else{
      ONBOARDING.form.baseUrl=provider.default_base_url||'';
    }
  }
  _renderOnboardingBody();
}

async function loadOnboardingWizard(){
  try{
    const status=await api('/api/onboarding/status');
    ONBOARDING.liveModelChoices=null;
    ONBOARDING.status=status;
    const current=((status.setup||{}).current)||{};
    const system=status.system||{};
    const currentProvider=current.provider||system.current_provider||'openrouter';
    const currentModel=current.model||system.current_model||status.settings.default_model||'';
    const currentBaseUrl=current.base_url||system.current_base_url||'';
    ONBOARDING.form.provider=currentProvider;
    ONBOARDING.form.workspace=(status.workspaces&&status.workspaces.last)||status.settings.default_workspace||'';
    ONBOARDING.form.model=currentModel;
    ONBOARDING.form.password='';
    ONBOARDING.form.apiKey='';
    ONBOARDING.form.baseUrl=currentBaseUrl;
    ONBOARDING.active=!status.completed;
    if(!ONBOARDING.active) return false;
    $('onboardingOverlay').style.display='flex';
    _renderOnboardingSteps();
    _renderOnboardingBody();
    return true;
  }catch(e){
    console.warn('onboarding status failed',e);
    return false;
  }
}

function prevOnboardingStep(){
  if(ONBOARDING.step===0)return;
  ONBOARDING.step--;
  _renderOnboardingSteps();
  _renderOnboardingBody();
}

async function _saveOnboardingProviderSetup(){
  const provider=(ONBOARDING.form.provider||'').trim();
  const model=(ONBOARDING.form.model||'').trim();
  const apiKey=(ONBOARDING.form.apiKey||'').trim();
  const baseUrl=(ONBOARDING.form.baseUrl||'').trim();
  const current=_getOnboardingCurrentSetup();
  const isUnchanged=current.provider===provider&&((current.model||'')===model)&&((current.base_url||'')===baseUrl);
  // Skip the POST when nothing changed.  We also skip when the provider is
  // unsupported/OAuth-based and already working — chat_ready may be false for
  // providers not in the quick-setup list (e.g. minimax-cn) even though they are
  // fully configured.  Posting in that case would either be a no-op (the server
  // just marks complete for unsupported providers) or could silently overwrite
  // config.yaml if the user accidentally changed the provider dropdown.
  const currentIsOauth=!!(ONBOARDING.status&&ONBOARDING.status.setup&&ONBOARDING.status.setup.current_is_oauth);
  if(isUnchanged && !apiKey && ((ONBOARDING.status.system||{}).chat_ready || currentIsOauth)) return;
  const body={provider,model};
  if(apiKey) body.api_key=apiKey;
  const pm=_getOnboardingSetupProvider(provider);
  let effectiveBase=(baseUrl||'').trim();
  if(pm&&_onboardingShowBaseUrlField(pm)){
    if(!effectiveBase&&pm.default_base_url) effectiveBase=String(pm.default_base_url).trim();
    body.base_url=effectiveBase;
  }
  if((ONBOARDING.status||{}).system&&ONBOARDING.status.system.config_exists) body.confirm_overwrite=true;
  let status=await api('/api/onboarding/setup',{method:'POST',body:JSON.stringify(body)});
  if(status&&status.error==='config_exists'){
    status=await api('/api/onboarding/setup',{method:'POST',body:JSON.stringify({...body,confirm_overwrite:true})});
  }
  if(status&&status.error) throw new Error(status.message||status.error||'Setup failed');
  ONBOARDING.status=status;
}

async function _saveOnboardingDefaults(){
  const workspace=(ONBOARDING.form.workspace||'').trim();
  const model=(ONBOARDING.form.model||'').trim();
  const password=(ONBOARDING.form.password||'').trim();
  if(!workspace) throw new Error(t('onboarding_error_choose_workspace'));
  if(!model) throw new Error(t('onboarding_error_choose_model'));
  const known=_getOnboardingWorkspaceChoices().some(ws=>ws.path===workspace);
  if(!known){
    await api('/api/workspaces/add',{method:'POST',body:JSON.stringify({path:workspace})});
  }
  // Match hermes-UI: persist the selected model in the client immediately so
  // the main composer reflects setup without waiting for a full reload.
  const body={default_workspace:workspace,default_model:model};
  if(password) body._set_password=password;
  const saved=await api('/api/settings',{method:'POST',body:JSON.stringify(body)});
  if(ONBOARDING.status){
    ONBOARDING.status.settings={...(ONBOARDING.status.settings||{}),password_enabled:!!saved.auth_enabled};
  }
  if(saved&&typeof saved.default_workspace==='string'&&saved.default_workspace.trim()){
    S._profileDefaultWorkspace=saved.default_workspace.trim();
  }
  const sel=$('modelSelect');
  const modelToApply=model;
  window._defaultModel=modelToApply;
  window._composerForcedModel=modelToApply;
  window._composerForcedModelProvider=window._activeProvider||null;
  try{
    localStorage.setItem('hermes-webui-model',modelToApply);
    if(typeof _writePersistedModelState==='function') _writePersistedModelState(modelToApply,window._activeProvider||null);
  }catch(_){}
  if(sel&&typeof _ensureModelOptionForImmediateSelection==='function'){
    _ensureModelOptionForImmediateSelection(modelToApply,sel,window._activeProvider||null);
  }else if(sel&&typeof _applyModelToDropdown==='function'){
    _applyModelToDropdown(modelToApply,sel,window._activeProvider||null);
  }
  if(window._modelDropdownReady){
    try{await window._modelDropdownReady;}catch(_){}
  }
  if(typeof refreshComposerModelFromServer==='function'){
    try{
      await refreshComposerModelFromServer({model:modelToApply,forceDefault:true,updateSession:true});
    }catch(e){
      console.warn('refreshComposerModelFromServer after onboarding',e);
    }
  }else if(sel&&typeof _applyModelToDropdown==='function'){
    const resolved=_applyModelToDropdown(modelToApply,sel,window._activeProvider||null);
    const persisted=resolved||modelToApply;
    if(typeof _writePersistedModelState==='function') _writePersistedModelState(persisted,window._activeProvider||null);
    else localStorage.setItem('hermes-webui-model',persisted);
  }
  if(typeof syncModelChip==='function') syncModelChip();
  if(typeof syncWorkspaceDisplays==='function') syncWorkspaceDisplays();
  if(typeof syncTopbar==='function') syncTopbar();
}

async function _finishOnboarding(){
  if(typeof clearLiveModelsClientCache==='function') clearLiveModelsClientCache();
  await _saveOnboardingProviderSetup();
  await _saveOnboardingDefaults();
  const done=await api('/api/onboarding/complete',{method:'POST',body:'{}'});
  ONBOARDING.status=done;
  ONBOARDING.active=false;
  $('onboardingOverlay').style.display='none';
  showToast(t('onboarding_complete'));
  try{
    const s=await api('/api/settings');
    if(s&&typeof s.default_workspace==='string'&&s.default_workspace.trim()){
      S._profileDefaultWorkspace=s.default_workspace.trim();
    }
  }catch(_){}
  await loadWorkspaceList();
  if(typeof clearLiveModelsClientCache==='function') clearLiveModelsClientCache();
  if(typeof populateModelDropdown==='function'){
    try{
      await populateModelDropdown();
      const persisted=(typeof _readPersistedModelState==='function')
        ? _readPersistedModelState()
        : (localStorage.getItem('hermes-webui-model')?{model:localStorage.getItem('hermes-webui-model'),model_provider:null}:null);
      const pref=(persisted&&persisted.model)||ONBOARDING.form.model;
      const prefProvider=(persisted&&persisted.model_provider)||window._activeProvider||null;
      window._composerForcedModel=pref;
      window._composerForcedModelProvider=prefProvider||null;
      if(pref&&$('modelSelect')&&typeof _ensureModelOptionForImmediateSelection==='function'){
        _ensureModelOptionForImmediateSelection(pref,$('modelSelect'),prefProvider);
      }else if(pref&&$('modelSelect')&&typeof _applyModelToDropdown==='function'){
        _applyModelToDropdown(pref,$('modelSelect'),prefProvider);
      }
      if(typeof syncModelChip==='function') syncModelChip();
    }catch(e){
      console.warn('post-onboarding model refresh failed',e);
    }
  }
  if(S.session&&ONBOARDING.form.model){
    S.session.model=ONBOARDING.form.model;
    S.session.model_provider=window._activeProvider||S.session.model_provider||null;
    try{
      await api('/api/session/update',{method:'POST',body:JSON.stringify({
        session_id:S.session.session_id,
        workspace:S.session.workspace,
        model:S.session.model,
        model_provider:S.session.model_provider||null,
      })});
    }catch(e){
      console.warn('post-onboarding session model update failed',e);
    }
  }
  if(typeof fetchReasoningChip==='function'){
    try{fetchReasoningChip();}catch(_){}
  }
  if(typeof renderSessionList==='function') await renderSessionList();
  if(!S.session && typeof newSession==='function'){
    await newSession(true);
    await renderSessionList();
  }
  if(typeof syncWorkspacePanelState==='function') syncWorkspacePanelState();
  if(typeof syncTopbar==='function') syncTopbar();
  if(typeof syncModelChip==='function') syncModelChip();
}

async function skipOnboarding(){
  try{
    // Mark onboarding completed server-side without changing any config
    await api('/api/onboarding/complete',{method:'POST',body:'{}'});
    ONBOARDING.active=false;
    $('onboardingOverlay').style.display='none';
    showToast(t('onboarding_skipped')||'Setup skipped');
  }catch(e){
    _setOnboardingNotice((e.message||String(e)),'warn');
  }
}

async function nextOnboardingStep(){
  try{
    if(ONBOARDING.steps[ONBOARDING.step]==='setup'){
      ONBOARDING.form.provider=(($('onboardingProviderSelect')||{}).value||ONBOARDING.form.provider||'').trim();
      ONBOARDING.form.apiKey=(($('onboardingApiKeyInput')||{}).value||'').trim();
      ONBOARDING.form.baseUrl=(($('onboardingBaseUrlInput')||{}).value||ONBOARDING.form.baseUrl||'').trim();
      if(!ONBOARDING.form.provider) throw new Error(t('onboarding_error_provider_required'));
      if(ONBOARDING.form.provider==='custom' && !ONBOARDING.form.baseUrl) throw new Error(t('onboarding_error_base_url_required'));
      const pm=_getOnboardingSetupProvider(ONBOARDING.form.provider);
      if(pm && !String(ONBOARDING.form.model||'').trim()) ONBOARDING.form.model=pm.default_model||'';
      await _saveOnboardingProviderSetup();
    }
    if(ONBOARDING.steps[ONBOARDING.step]==='workspace'){
      ONBOARDING.form.workspace=(($('onboardingWorkspaceInput')||{}).value||ONBOARDING.form.workspace||'').trim();
      ONBOARDING.form.model=(($('onboardingModelInput')||{}).value||($('onboardingModelSelect')||{}).value||ONBOARDING.form.model||'').trim();
      if(!ONBOARDING.form.workspace) throw new Error(t('onboarding_error_workspace_required'));
      if(!ONBOARDING.form.model) throw new Error(t('onboarding_error_model_required'));
    }
    if(ONBOARDING.steps[ONBOARDING.step]==='password'){
      ONBOARDING.form.password=(($('onboardingPasswordInput')||{}).value||'').trim();
    }
    if(ONBOARDING.step===ONBOARDING.steps.length-1){
      await _finishOnboarding();
      return;
    }
    ONBOARDING.step++;
    _renderOnboardingSteps();
    _renderOnboardingBody();
  }catch(e){
    _setOnboardingNotice(e.message||String(e),'warn');
  }
}

/* ── Codex OAuth device-code flow ── */
let _codexOAuthSSE=null;

async function startCodexOAuth(){
  const flowDiv=$('codexOAuthFlow');
  const btn=$('codexOAuthBtn');
  if(!flowDiv)return;
  if(btn){btn.disabled=true;btn.textContent='...';}
  flowDiv.style.display='block';
  flowDiv.innerHTML=`<div class="onboarding-oauth-card onboarding-oauth-pending"><div class="onboarding-oauth-icon">⏳</div><div><strong>${t('oauth_codex_polling')}</strong><p>Starting device-code flow…</p></div></div>`;
  try{
    const resp=await api('/api/oauth/codex/start',{method:'POST'});
    if(resp.error) throw new Error(resp.error);
    const{device_code,user_code,verification_uri}=resp;
    if(!device_code||!user_code||!verification_uri) throw new Error('Invalid OAuth response');
    // Open verification URI in new tab
    window.open(verification_uri,'_blank');
    // Show user code prominently
    flowDiv.innerHTML=`
      <div class="onboarding-oauth-card onboarding-oauth-pending">
        <div class="onboarding-oauth-icon">📋</div>
        <div style="flex:1">
          <strong>${t('oauth_codex_step1')}</strong>
          <p><a href="${esc(verification_uri)}" target="_blank" rel="noopener" style="color:var(--accent);word-break:break-all">${esc(verification_uri)}</a></p>
          <p style="margin-top:8px"><strong>${t('oauth_codex_step2')}</strong></p>
          <code style="display:inline-block;font-size:18px;letter-spacing:0.1em;background:rgba(255,255,255,.08);padding:6px 14px;border-radius:8px;margin-top:4px;user-select:all">${esc(user_code)}</code>
          <p style="margin-top:8px;color:var(--muted);font-size:13px">${t('oauth_codex_polling')}</p>
        </div>
      </div>`;
    // Connect to SSE poll endpoint
    const pollUrl=new URL('api/oauth/codex/poll?device_code='+encodeURIComponent(device_code),location.href);
    if(_codexOAuthSSE){_codexOAuthSSE.close();_codexOAuthSSE=null;}
    _codexOAuthSSE=new EventSource(pollUrl.href);
    _codexOAuthSSE.onmessage=function(ev){
      let data;
      try{data=JSON.parse(ev.data);}catch(e){return;}
      if(data.status==='success'){
        if(_codexOAuthSSE){_codexOAuthSSE.close();_codexOAuthSSE=null;}
        flowDiv.innerHTML=`
          <div class="onboarding-oauth-card onboarding-oauth-ready">
            <div class="onboarding-oauth-icon">✅</div>
            <div><strong>${t('oauth_codex_success')}</strong>
            <p>Token saved to credential pool. You can now use Codex as a provider.</p></div>
          </div>`;
        if(btn){btn.disabled=false;btn.textContent=t('oauth_login_codex');}
        showToast(t('oauth_codex_success'));
        // Refresh onboarding status in background
        loadOnboardingWizard().catch(()=>{});
      }else if(data.status==='error'){
        if(_codexOAuthSSE){_codexOAuthSSE.close();_codexOAuthSSE=null;}
        const isExpired=(data.error||'').includes('expired');
        flowDiv.innerHTML=`
          <div class="onboarding-oauth-card" style="border-color:var(--error,#e55)">
            <div class="onboarding-oauth-icon">❌</div>
            <div><strong>${isExpired?t('oauth_codex_expired'):t('oauth_codex_error')}</strong>
            <p>${esc(data.error||'Unknown error')}</p></div>
          </div>`;
        if(btn){btn.disabled=false;btn.textContent=t('oauth_login_codex');}
      }
      // 'polling' status — keep waiting
    };
    _codexOAuthSSE.onerror=function(){
      if(_codexOAuthSSE){_codexOAuthSSE.close();_codexOAuthSSE=null;}
      if(btn){btn.disabled=false;btn.textContent=t('oauth_login_codex');}
      // Don't overwrite if already showing success/error
      if(!flowDiv.querySelector('.onboarding-oauth-ready')&&!flowDiv.querySelector('[style*="error"]')){
        flowDiv.innerHTML=`
          <div class="onboarding-oauth-card" style="border-color:var(--error,#e55)">
            <div class="onboarding-oauth-icon">❌</div>
            <div><strong>${t('oauth_codex_error')}</strong><p>Connection lost. Please try again.</p></div>
          </div>`;
      }
    };
  }catch(e){
    flowDiv.innerHTML=`
      <div class="onboarding-oauth-card" style="border-color:var(--error,#e55)">
        <div class="onboarding-oauth-icon">❌</div>
        <div><strong>${t('oauth_codex_error')}</strong><p>${esc(e.message||String(e))}</p></div>
      </div>`;
    if(btn){btn.disabled=false;btn.textContent=t('oauth_login_codex');}
  }
}
