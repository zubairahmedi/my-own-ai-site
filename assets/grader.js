(function () {
  var $ = function (id) { return document.getElementById(id); };
  var MESSAGES = {
    bad_url: "That doesn't look like a web address. Try something like yourbrand.com/franchise.",
    blocked_host: "We can't check that address.",
    unreachable: "We couldn't reach that site. Check the address and try again.",
    blocked: "That site blocked our check, so we can't grade it from here.",
    not_html: "That address isn't a web page.",
    unreadable: "That page builds itself with scripts, so we can't read enough of it to grade it fairly.",
    rate_limited: "You've run a lot of checks. Try again in an hour."
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function error(reason) {
    $('gradeError').textContent = MESSAGES[reason] || 'Something went wrong. Please try again.';
    $('gradeError').hidden = false;
    $('gradeResult').hidden = true;
  }

  function render(r) {
    $('gScore').textContent = r.score;
    $('gLabel').textContent = r.label;
    $('gPage').textContent = r.gradedUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    $('gNote').hidden = !!r.devPageFound;

    var fixes = $('gFixes');
    fixes.textContent = '';
    r.fixes.forEach(function (f) {
      var li = el('li');
      li.appendChild(el('b', null, f.label));
      li.appendChild(el('p', null, f.fix));
      fixes.appendChild(li);
    });
    $('gFixBox').hidden = !r.fixes.length;

    var list = $('gChecks');
    list.textContent = '';
    r.checks.forEach(function (c) {
      var li = el('li', c.pass ? 'pass' : c.unknown ? 'unk' : 'miss');
      li.appendChild(el('i', null, c.pass ? '✓' : c.unknown ? '?' : '✕'));
      var body = el('div');
      body.appendChild(el('b', null, c.label));
      body.appendChild(el('p', null, (c.pass ? 'Found.' : c.unknown ? "We couldn't see the form itself, so we can't check its wording. Left out of the score." : "We couldn't find this on the pages we read.") + (c.benchmark ? ' ' + c.benchmark + '.' : '')));
      li.appendChild(body);
      list.appendChild(li);
    });
    $('gradeError').hidden = true;
    $('gradeResult').hidden = false;
    $('gradeResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('gradeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('gradeBtn'), label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Reading the page...';
    $('gradeError').hidden = true;
    fetch('/api/grade/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: $('gradeUrl').value }) })
      .then(function (res) { return res.json(); })
      .then(function (r) { if (r.ok) render(r); else error(r.reason); })
      .catch(function () { error('unknown'); })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  });
})();
