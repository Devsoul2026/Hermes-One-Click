function openLogsModal(){
  const modal=document.getElementById('logsModal');
  const status=document.getElementById('logsModalStatus');
  if(!modal)return;
  modal.style.display='flex';
  modal.setAttribute('aria-hidden','false');
  if(status)status.textContent='正在读取日志状态…';
  api('/api/logs/status').then(data=>{
    if(!status)return;
    const size=Number(data.client_events_size||0);
    const mb=(size/1024/1024).toFixed(2);
    status.textContent=`当前诊断日志约 ${mb} MB，每日自动清理，导出文件保留 24 小时。`;
  }).catch(e=>{
    if(status)status.textContent=`读取日志状态失败：${e.message||e}`;
  });
}

function closeLogsModal(){
  const modal=document.getElementById('logsModal');
  if(!modal)return;
  modal.style.display='none';
  modal.setAttribute('aria-hidden','true');
}

async function exportHermesLogs(){
  const btn=document.getElementById('btnExportHermesLogs');
  const status=document.getElementById('logsModalStatus');
  if(btn){btn.disabled=true;btn.textContent='正在导出…';}
  if(status)status.textContent='正在打包日志，请稍候…';
  try{
    const res=await fetch(new URL('api/logs/export',document.baseURI||location.href).href,{credentials:'include'});
    if(!res.ok){
      const text=await res.text();
      throw new Error(text||`HTTP ${res.status}`);
    }
    const blob=await res.blob();
    const cd=res.headers.get('content-disposition')||'';
    const match=/filename="([^"]+)"/i.exec(cd);
    const filename=match?match[1]:`hermes-logs-${new Date().toISOString().replace(/[:.]/g,'-')}.zip`;
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
    if(status)status.textContent=`已导出：${filename}`;
    if(typeof showToast==='function')showToast('日志已导出',2200,'success');
  }catch(e){
    const msg=e&&e.message?e.message:String(e);
    if(status)status.textContent=`导出失败：${msg}`;
    if(typeof showToast==='function')showToast(`日志导出失败：${msg}`,3600,'error');
  }finally{
    if(btn){btn.disabled=false;btn.textContent='导出日志';}
  }
}

if(typeof window!=='undefined'){
  window.openLogsModal=openLogsModal;
  window.closeLogsModal=closeLogsModal;
  window.exportHermesLogs=exportHermesLogs;
}
