(function () {
  var form = document.getElementById('leadForm');
  if (!form) return;
  var WEBHOOK_URL = 'https://n8n.zehaanai.com/webhook/zehaanai';
  var btn = document.getElementById('submitBtn');
  var err = document.getElementById('formError');
  var done = document.getElementById('formDone');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (form.elements.website.value) return; // honeypot: bots fill the hidden field
    var label = btn.textContent;
    err.hidden = true;
    btn.textContent = 'Sending...';
    btn.disabled = true;
    var crm = form.elements.crm.value;
    var note = form.elements.note.value.trim();
    var payload = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      company: form.elements.brand.value.trim(),
      crm: crm,
      message: 'CRM: ' + crm + (note ? '\n' + note : ''),
      timestamp: new Date().toISOString(),
      source: 'zehaanai-franchise',
      page: location.href
    };
    fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        form.hidden = true;
        done.hidden = false;
      })
      .catch(function () {
        // never show a false success: if it didn't land, say so and keep what they typed
        err.hidden = false;
        btn.textContent = label;
        btn.disabled = false;
      });
  });
})();
