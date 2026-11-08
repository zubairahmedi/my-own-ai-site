// CRM Leak Scanner engine. Runs in the browser and in Node (for tests). Makes no network calls.
(function (root) {
  var DAY = 86400000;
  var CLOSED = /\b(lost|won|closed|awarded|signed|sold|dead|junk|spam|unqualified|disqualified|not qualified|do not (call|contact)|dnc|unsubscribed|opted? out)\b/i;
  var NO_OWNER = /^(|-|n\/?a|none|null|unassigned|no owner|not assigned)$/i;
  var GUESS = {
    created: [/^(date )?created( (at|on|date))?$/, /^create date$/, /^date added$/, /created/, /(lead|inquiry|submission|form) date/, /submitted/],
    activity: [/last activity/, /last (contact|contacted|engagement|touch|call)/, /recent activity/, /last (sales )?activity/],
    owner: [/(contact|lead|deal) owner/, /^owner/, /assigned/, /consultant/, /sales ?rep/, /^rep$/],
    stage: [/lead status/, /pipeline stage/, /lifecycle/, /^stage/, /^status/, /disposition/],
    touches: [/times contacted/, /number of (sales )?activities/, /(call|touch|attempt|outreach) count/, /(calls|touches|attempts)( made)?$/, /number of (calls|touches|attempts)/],
    source: [/original (traffic )?source/, /(lead|contact) source/, /^source/, /utm source/]
  };

  function parseCSV(text) {
    text = String(text).replace(/^﻿/, '');
    var first = '', inQ = false;
    for (var k = 0; k < text.length; k++) {
      var c0 = text[k];
      if (c0 === '"') inQ = !inQ;
      if (!inQ && (c0 === '\n' || c0 === '\r')) break;
      first += inQ ? '' : c0;
    }
    var delim = [',', ';', '\t', '|'].reduce(function (best, d) {
      return first.split(d).length > first.split(best).length ? d : best;
    }, ',');

    var rows = [], row = [], field = '', quoted = false, i = 0, n = text.length;
    while (i < n) {
      var c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { quoted = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(function (v) { return v.trim() !== ''; })) rows.push(row);
        row = []; i++; continue;
      }
      field += c; i++;
    }
    row.push(field);
    if (row.some(function (v) { return v.trim() !== ''; })) rows.push(row);
    if (!rows.length) return { headers: [], rows: [] };
    return { headers: rows[0].map(function (h) { return h.trim(); }), rows: rows.slice(1) };
  }

  function guessColumns(headers) {
    var norm = headers.map(function (h) { return h.toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim(); });
    var used = {}, map = {};
    ['activity', 'created', 'touches', 'owner', 'stage', 'source'].forEach(function (key) {
      map[key] = -1;
      GUESS[key].some(function (re) {
        var at = norm.findIndex(function (h, i) { return !used[i] && re.test(h); });
        if (at >= 0) { map[key] = at; used[at] = true; return true; }
        return false;
      });
    });
    return map;
  }

  function parseDate(value, now) {
    var s = String(value == null ? '' : value).trim();
    if (!s) return null;
    now = now || Date.now();
    var t = null, m;
    if (/^\d{5}(\.\d+)?$/.test(s)) t = (parseFloat(s) - 25569) * DAY; // Excel serial date
    else if (/^\d{10}$/.test(s)) t = parseInt(s, 10) * 1000;
    else if (/^\d{13}$/.test(s)) t = parseInt(s, 10);
    else if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?/i))) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += 2000;
      var mon = a, day = b;
      if (a > 12 && b <= 12) { mon = b; day = a; } // day first when it can only be day first
      if (mon > 12 || day > 31) return null;
      var h = m[4] ? +m[4] : 0;
      if (m[7]) { h = h % 12; if (/p/i.test(m[7])) h += 12; }
      t = Date.UTC(y, mon - 1, day, h, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
    } else {
      t = Date.parse(s);
    }
    if (t == null || isNaN(t)) return null;
    if (t < Date.UTC(2000, 0, 1) || t > now + DAY) return null;
    return t;
  }

  function parseCount(value) {
    var s = String(value == null ? '' : value).replace(/,/g, '').trim();
    if (!s) return 0;
    var n = parseFloat(s);
    return isNaN(n) || n < 0 ? 0 : n;
  }

  function group(store, key, flags) {
    var g = store[key] || (store[key] = { name: key, leads: 0, never: 0, stale: 0 });
    g.leads++;
    if (flags.never) g.never++;
    if (flags.stale) g.stale++;
  }

  function topGroups(store, limit) {
    var all = Object.keys(store).map(function (k) { return store[k]; }).sort(function (a, b) { return b.leads - a.leads; });
    if (all.length <= limit) return all;
    var rest = { name: 'Everything else', leads: 0, never: 0, stale: 0 };
    all.slice(limit - 1).forEach(function (g) { rest.leads += g.leads; rest.never += g.never; rest.stale += g.stale; });
    return all.slice(0, limit - 1).concat(rest);
  }

  function scan(rows, map, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var staleDays = opts.staleDays || 30;
    var cpl = opts.cpl == null ? 351 : opts.cpl;
    var cutoff = opts.months ? now - opts.months * 30.44 * DAY : null;
    var has = { created: map.created >= 0, activity: map.activity >= 0, owner: map.owner >= 0, stage: map.stage >= 0, touches: map.touches >= 0, source: map.source >= 0 };
    var r = { total: rows.length, scanned: 0, skippedOld: 0, undated: 0, never: 0, oneTouch: 0, stale: 0, noOwner: 0, closed: 0, badDates: 0, has: has, importWarning: null };
    var days = {}, sources = {}, owners = {};

    rows.forEach(function (row) {
      var cell = function (i) { return i >= 0 && row[i] != null ? String(row[i]).trim() : ''; };
      var created = null;
      if (has.created) {
        var rawC = cell(map.created);
        created = parseDate(rawC, now);
        if (rawC && created == null) r.badDates++;
        if (created == null) r.undated++;
      }
      if (cutoff != null && has.created && (created == null || created < cutoff)) { r.skippedOld++; return; }
      r.scanned++;
      if (created != null) {
        var d = new Date(created).toISOString().slice(0, 10);
        days[d] = (days[d] || 0) + 1;
      }

      var rawA = cell(map.activity);
      var activity = has.activity ? parseDate(rawA, now) : null;
      if (has.activity && rawA && activity == null) r.badDates++;
      var touches = has.touches ? parseCount(cell(map.touches)) : null;
      var isClosed = has.stage && CLOSED.test(cell(map.stage));
      if (isClosed) r.closed++;

      var never = false;
      if (has.touches) never = touches === 0;
      else if (has.activity) never = activity == null;
      var one = has.touches && touches === 1;
      var stale = has.activity && !never && !isClosed && activity != null && now - activity > staleDays * DAY;
      var unowned = has.owner && NO_OWNER.test(cell(map.owner));

      if (never) r.never++;
      if (one) r.oneTouch++;
      if (stale) r.stale++;
      if (unowned) r.noOwner++;

      var flags = { never: never, stale: stale };
      if (has.source) group(sources, cell(map.source) || 'No source recorded', flags);
      if (has.owner) group(owners, unowned ? 'No owner' : cell(map.owner), flags);
    });

    r.neverCost = r.never * cpl;
    r.oneTouchCost = r.oneTouch * cpl;
    r.bySource = topGroups(sources, 8);
    r.byOwner = topGroups(owners, 10);
    var peak = Object.keys(days).reduce(function (best, d) { return days[d] > (days[best] || 0) ? d : best; }, '');
    if (peak && days[peak] >= 20 && days[peak] / r.scanned >= 0.2) r.importWarning = { date: peak, count: days[peak], share: days[peak] / r.scanned };
    return r;
  }

  function sampleCSV(now) {
    now = now || Date.now();
    var sources = ['Facebook ads', 'Franchise portal', 'Website form', 'Broker', 'Trade show'];
    var owners = ['Rep A', 'Rep B', 'Rep C', 'Rep D', ''];
    var stages = ['New', 'Working', 'Intro call booked', 'Lost', 'Working'];
    var seed = 7;
    var rnd = function (n) { seed = (seed * 16807) % 2147483647; return seed % n; };
    var iso = function (t) { return new Date(t).toISOString().slice(0, 10); };
    var out = ['Created,Last Activity,Assigned To,Stage,Number of Calls,Lead Source'];
    for (var i = 0; i < 420; i++) {
      var created = now - (2 + rnd(520)) * DAY;
      var bucket = rnd(100);
      var calls = bucket < 24 ? 0 : bucket < 45 ? 1 : 2 + rnd(6);
      var last = calls === 0 ? '' : iso(Math.min(now - DAY, created + rnd(70) * DAY));
      out.push([iso(created), last, owners[rnd(100) < 9 ? 4 : rnd(4)], stages[rnd(5)], calls, sources[rnd(5)]].join(','));
    }
    return out.join('\n');
  }

  var api = { parseCSV: parseCSV, guessColumns: guessColumns, parseDate: parseDate, parseCount: parseCount, scan: scan, sampleCSV: sampleCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LeakScanner = api;
})(this);
