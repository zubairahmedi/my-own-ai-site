(function () {
  var AVERAGE = 17550; // 2026 AFDR, 2025 data
  function num(id) {
    var v = parseFloat(document.getElementById(id).value);
    return isFinite(v) && v > 0 ? v : 0;
  }
  function set(id, text) { document.getElementById(id).textContent = text; }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function count(n) { return n.toLocaleString('en-US', { maximumFractionDigits: 1 }); }

  function update() {
    var leads = num('leads') * 12;
    var cpl = num('cpl');
    var rate = Math.min(num('rate'), 100);
    var unworked = Math.min(num('unworked'), 100);
    var spend = leads * cpl + num('other') * 12;
    var deals = leads * rate / 100;
    var waste = leads * cpl * unworked / 100;
    var extra = deals * unworked / 100;

    set('rDeals', count(deals));
    set('rPerDeal', rate > 0 ? count(100 / rate) : '0');
    set('rSpend', money(spend));
    set('rWaste', money(waste));

    if (deals > 0 && spend > 0) {
      var cps = spend / deals;
      var diff = Math.abs(cps - AVERAGE) / AVERAGE * 100;
      set('rCps', money(cps));
      set('rCompare', diff < 1 ? 'About the same as the $17,550 industry average.'
        : Math.round(diff) + '% ' + (cps > AVERAGE ? 'above' : 'below') + ' the $17,550 industry average.');
    } else {
      set('rCps', '$0');
      set('rCompare', 'Enter your leads, cost per lead and close rate.');
    }
    set('rExtra', unworked > 0 && deals > 0
      ? 'If your unworked leads signed at your current rate, that would be about ' + count(extra) + ' more deals a year. This is arithmetic, not a forecast.'
      : '');
  }

  var form = document.getElementById('calc');
  form.addEventListener('input', update);
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  update();
})();
