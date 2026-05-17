/* Business cooperation modal — mission, plain-text email, Feishu QR (no mailto). */

/**
 * Open the Skill Market page in the system's default browser.
 * Uses the existing /api/open-url endpoint so we don't need to
 * modify hermes-agent source code.
 */
function openSkillMarket() {
  fetch('/api/open-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://maoba.org.cn/skill-market' }),
  }).catch(function () {
    // Fallback: try window.open (may be blocked in WebView2)
    window.open('https://maoba.org.cn/skill-market', '_blank', 'noopener');
  });
}

if (typeof window !== 'undefined') {
  window.openSkillMarket = openSkillMarket;
}


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
