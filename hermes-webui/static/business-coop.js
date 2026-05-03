/* Business cooperation modal — mission, plain-text email, Feishu QR (no mailto). */

function _businessEsc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function _businessCoopModalHtml() {
  return (
    '<p>' +
    _businessEsc(t('business_modal_mission')) +
    '</p>' +
    '<p>' +
    _businessEsc(t('business_modal_cta')) +
    '</p>' +
    '<p class="business-co-op-email">' +
    '<span data-i18n="business_modal_email_label"></span>' +
    _businessEsc('cs@devsoul.cn') +
    '</p>' +
    '<img class="about-mb-feishu-qr" src="static/fs.jpg" alt="" decoding="async">'
  );
}

function openBusinessCoopModal() {
  const modal = document.getElementById('businessCoopModal');
  const body = document.getElementById('businessCoopModalBody');
  if (!modal || !body) return;
  body.innerHTML = _businessCoopModalHtml();
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  if (typeof applyLocaleToDOM === 'function') applyLocaleToDOM();
}

function closeBusinessCoopModal() {
  const modal = document.getElementById('businessCoopModal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
}

if (typeof window !== 'undefined') {
  window.openBusinessCoopModal = openBusinessCoopModal;
  window.closeBusinessCoopModal = closeBusinessCoopModal;
}
