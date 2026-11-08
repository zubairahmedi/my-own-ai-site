(function () {
  var S = window.LeakScanner;
  var $ = function (id) { return document.getElementById(id); };
  var WEBHOOK_URL = 'https://n8n.zehaanai.com/webhook/zehaanai';
  var FIELDS = [
    ['created', 'Date created'], ['activity', 'Last activity date'], ['touches', 'Number of calls or touches'],
    ['owner', 'Owner or assigned rep'], ['stage', 'Stage or status'], ['source', 'Lead source']
  ];
  var data = null, map = null;

  function num(n) { return Math.round(n).toLocaleString('en-US'); }
  function pct(a, b) { return b ? Math.round(a / b * 100) + '%' : '0%'; }
  function money(n) { return '$' + num(n); }
  function set(id, text) { $(id).textContent = text; }
  function show(el, on) { el.hidden = !on; }

  function fail(message) {
    set('scanError', message);
    show($('scanError'), true);
    show($('scanTool'), false);
  }

  function buildMapping() {
    var box = $('mapping');
    box.textContent = '';
    FIELDS.forEach(function (f) {
      var wrap = document.createElement('div');
      wrap.className = 'field';
      var label = document.createElement('label');
      label.htmlFor = 'map-' + f[0];
      label.textContent = f[1];
      var sel = document.createElement('select');
      sel.id = 'map-' + f[0];
      var none = document.createElement('option');
      none.value = '-1';
      none.textContent = 'Not in my export';
      sel.appendChild(none);
      data.headers.forEach(function (h, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = h || 'Column ' + (i + 1);
        sel.appendChild(o);
      });
      sel.value = String(map[f[0]]);
      sel.addEventListener('change', function () { map[f[0]] = parseInt(sel.value, 10); run(); });
      wrap.appendChild(label);
      wrap.appendChild(sel);
      box.appendChild(wrap);
    });
  }

  function tile(id, value, note) {
    set(id, value);
    set(id + 'Note', note);
  }

  function renderBars(id, groups, r) {
    var host = $(id);
    host.textContent = '';
    var top = groups.reduce(function (m, g) { return Math.max(m, g.leads ? g.never / g.leads : 0); }, 0);
    groups.forEach(function (g) {
      var share = g.leads ? g.never / g.leads : 0;
      var row = document.createElement('div');
      row.className = 'row';
      row.title = g.name + ': ' + num(g.never) + ' of ' + num(g.leads) + ' never worked';
      var lb = document.createElement('span');
      lb.className = 'lb';
      lb.textContent = g.name;
      var tr = document.createElement('span');
      tr.className = 'tr';
      var bar = document.createElement('i');
      bar.className = 'w-' + Math.max(1, Math.round(top ? share / top * 70 : 1));
      var val = document.createElement('em');
      val.textContent = pct(g.never, g.leads) + ' of ' + num(g.leads);
      tr.appendChild(bar);
      tr.appendChild(val);
      row.appendChild(lb);
      row.appendChild(tr);
      host.appendChild(row);
    });
  }

  function run() {
    var months = parseInt($('range').value, 10);
    var r = S.scan(data.rows, map, {
      staleDays: Math.max(1, parseInt($('staleDays').value, 10) || 30),
      cpl: Math.max(0, parseFloat($('cpl').value) || 0),
      months: months || null
    });
    var has = r.has, n = r.scanned;
    var canNever = has.touches || has.activity;
    set('rScanned', num(n) + ' leads scanned');
    set('rDate', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));

    set('rNever', canNever ? num(r.never) : 'Not enough data');
    set('rNeverCap', canNever
      ? 'leads you paid for with no recorded call or activity (' + pct(r.never, n) + ' of your leads)'
      : 'Choose a last activity or calls column above.');
    set('rCost', canNever && r.neverCost ? money(r.neverCost) + ' spent on those leads, at your cost per lead' : '');

    tile('tOne', has.touches ? num(r.oneTouch) : 'n/a', has.touches ? 'got exactly one touch (' + pct(r.oneTouch, n) + ')' : 'needs a calls or touches column');
    tile('tStale', has.activity ? num(r.stale) : 'n/a', has.activity ? 'open leads gone quiet for ' + (parseInt($('staleDays').value, 10) || 30) + '+ days' : 'needs a last activity column');
    tile('tOwner', has.owner ? num(r.noOwner) : 'n/a', has.owner ? 'have no owner (' + pct(r.noOwner, n) + ')' : 'needs an owner column');
    tile('tClosed', has.stage ? num(r.closed) : 'n/a', has.stage ? 'are closed, and not counted as stale' : 'needs a stage column');

    show($('srcBox'), has.source && canNever && r.bySource.length > 0);
    show($('ownBox'), has.owner && canNever && r.byOwner.length > 0);
    if (has.source && canNever) renderBars('srcBars', r.bySource, r);
    if (has.owner && canNever) renderBars('ownBars', r.byOwner, r);

    var imp = r.importWarning;
    show($('importNote'), !!imp);
    if (imp) set('importNote', num(imp.count) + ' leads (' + pct(imp.count, n) + ') share one created date, ' + imp.date + '. That usually means a bulk import, which can skew these numbers. It happened in our own data too.');
    var parts = [];
    if (r.skippedOld) parts.push(num(r.skippedOld) + ' leads were left out by your date range.');
    if (r.badDates) parts.push(num(r.badDates) + ' dates could not be read.');
    set('dataNote', parts.join(' '));
    show($('scanTool'), true);
    show($('scanError'), false);
  }

  function load(text, name, sample) {
    var parsed;
    try { parsed = S.parseCSV(text); } catch (e) { return fail('That file could not be read. Try exporting it again as a CSV.'); }
    if (parsed.headers.length < 2 || !parsed.rows.length) return fail('That file doesn\'t look like a CSV export with leads in it.');
    data = parsed;
    map = S.guessColumns(parsed.headers);
    set('fileName', sample ? 'Sample data, not real leads' : name);
    buildMapping();
    run();
    $('scanTool').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) return fail('That file is over 100 MB. Try exporting fewer columns.');
    file.text().then(function (t) { load(t, file.name, false); }, function () { fail('That file could not be opened.'); });
  }

  $('file').addEventListener('change', function (e) { readFile(e.target.files[0]); });
  $('sample').addEventListener('click', function () { load(S.sampleCSV(), '', true); });
  ['cpl', 'staleDays', 'range'].forEach(function (id) { $(id).addEventListener('input', function () { if (data) run(); }); });
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { readFile(e.dataTransfer.files[0]); });

  function printReport() {
    document.body.classList.add('printing');
    window.print();
  }
  window.addEventListener('afterprint', function () { document.body.classList.remove('printing'); });
  $('printBtn').addEventListener('click', printReport);

  $('pdfForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    if (form.elements.website.value) return;
    var btn = $('pdfSubmit');
    btn.disabled = true;
    btn.textContent = 'One moment...';
    // only these contact details are sent: nothing from the file or the results
    fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        company: form.elements.brand.value.trim(),
        message: 'Requested the CRM Leak Scanner PDF',
        timestamp: new Date().toISOString(),
        source: 'zehaanai-leak-scanner',
        page: location.href
      })
    }).catch(function () { return null; }).then(function () {
      show(form, false);
      show($('pdfReady'), true);
      printReport();
    });
  });
})();
