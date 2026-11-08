// Franchise website grader engine. Used by the site's /api/grade function and the batch report builder.
const dns = require('dns').promises;
const net = require('net');

const UA = 'ZehaanAI-SiteGrader/1.0 (+https://zehaanai.com/tools/franchise-website-grader/)';
const MAX_BYTES = 1500000;
const SHOP = '2025 ServiceScore mystery shop';

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIP(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb');
}

function normalizeUrl(input) {
  let s = String(input == null ? '' : input).trim();
  if (!s || s.length > 300) throw new Error('bad_url');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad_url');
  if (u.username || u.password) throw new Error('bad_url');
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('bad_url');
  if (!u.hostname.includes('.')) throw new Error('bad_url');
  u.hash = '';
  return u.toString();
}

async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || /\.(local|internal|localhost|intranet|lan|home|corp)$/.test(host)) throw new Error('blocked_host');
  if (net.isIP(host)) { if (isPrivateIP(host)) throw new Error('blocked_host'); return; }
  const found = await dns.lookup(host, { all: true });
  if (!found.length || found.some(a => isPrivateIP(a.address))) throw new Error('blocked_host');
}

async function readLimited(res) {
  if (!res.body || !res.body.getReader) return (await res.text()).slice(0, MAX_BYTES);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) { chunks.push(value.slice(0, MAX_BYTES - (total - value.length))); await reader.cancel(); break; }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
}

async function fetchPage(startUrl, timeoutMs) {
  let url = startUrl;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(url);
    if (u.port && u.port !== '80' && u.port !== '443') throw new Error('blocked_host');
    await assertPublicHost(u.hostname);
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(timeoutMs || 5000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url).toString();
      if (res.body && res.body.cancel) await res.body.cancel().catch(() => {});
      continue;
    }
    const type = res.headers.get('content-type') || '';
    if (type && !/html|xml/i.test(type)) { if (res.body && res.body.cancel) await res.body.cancel().catch(() => {}); throw new Error('not_html'); }
    return { url, status: res.status, html: res.status < 400 ? await readLimited(res) : '' };
  }
  throw new Error('too_many_redirects');
}

function decode(s) {
  return s.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&#36;|&dollar;/g, '$').replace(/&ndash;|&mdash;|&#8211;|&#8212;/g, '-');
}

function toText(html) {
  return decode(String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const EMBED_FORM = /hsforms|hs-form|hbspt\.forms|typeform|jotform|gravityform|wpforms|formstack|cognitoforms|leadconnector|msgsndr|marketo|mktoForm|pardot|fransmart|franconnect|wufoo|formassembly|ninja-forms|elementor-form|wpcf7/i;

const INQUIRY_LINK = /<a\b[^>]*href=["'][^"']*(contact|inquir|enquir|request|apply|get-started|learn-more)[^"']*["'][^>]*>[\s\S]{0,120}?(request|apply|inquire|enquire|get started|learn more|contact us)/i;

function hasMoneyNear(text) {
  const re = /(investment|franchise fee|liquid (capital|assets)|cash required|capital required)/gi;
  let m;
  while ((m = re.exec(text))) {
    const near = text.slice(Math.max(0, m.index - 130), m.index + m[0].length + 130);
    if (/\$\s?\d/.test(near)) return true;
  }
  return false;
}

const CHECKS = [
  { id: 'form', label: 'A way to inquire', weight: 15, fix: 'Put a short inquiry form on the franchise page itself, so nobody has to hunt for it.',
    test: p => /<form\b/i.test(p.html) || EMBED_FORM.test(p.html) || INQUIRY_LINK.test(p.html) },
  { id: 'investment', label: 'Investment figures shown', weight: 15, benchmark: `38 of 101 sites in the ${SHOP} showed Item 7 investment information`, fix: 'Show the investment range from Item 7 on the page, so serious candidates qualify themselves.',
    test: p => hasMoneyNear(p.text) || /\bitem\s*7\b/i.test(p.text) },
  { id: 'criteria', label: 'Who you are looking for', weight: 10, benchmark: `56 of 101 sites in the ${SHOP} included candidate information`, fix: 'Say who makes a good owner: background, involvement and financial requirements.',
    test: p => /ideal (candidate|franchisee|owner|partner)|looking for|what we look for|qualifications|requirements|right fit|net worth|liquid capital|liquidity/i.test(p.text) },
  { id: 'territory', label: 'Available territories', weight: 10, benchmark: `77 of 101 sites in the ${SHOP} listed available territories`, fix: 'List or map your open markets. It is one of the first things a candidate wants to know.',
    test: p => /available (markets?|territor|locations?)|open (markets?|territor)|territor(y|ies)\b|markets? available|where (we're|we are) (expanding|growing)/i.test(p.text) },
  { id: 'phone', label: 'A phone number to call', weight: 10, benchmark: `55% of brands in the ${SHOP} published a development phone number`, fix: 'Publish a development phone number that reaches someone who can handle an inquiry.',
    test: p => /href=["']tel:/i.test(p.html) || /(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(p.text) },
  { id: 'consent', label: 'Consent wording for calls and texts', weight: 10, fix: 'Add clear consent wording near the form that names your brand and covers calls and texts.',
    test: p => /by (submitting|clicking|providing|checking)|i (agree|consent)|consent to|agree to receive|message (and|&) data rates|msg (&|and) data|autodial|tcpa/i.test(p.text) },
  { id: 'privacy', label: 'Privacy policy link', weight: 5, fix: 'Link your privacy policy from the page.',
    test: p => /privacy/i.test(p.text) || /href=["'][^"']*privacy/i.test(p.html) },
  { id: 'cta', label: 'A clear next step', weight: 5, fix: 'Add one clear button, like "Request information", and repeat it down the page.',
    test: p => /request (info|more|a)|get started|learn more|apply now|inquire|enquire|download|start your|contact us|free (info|guide|consult)|speak with|schedule a|talk to/i.test(p.text) },
  { id: 'proof', label: 'Proof from owners or rankings', weight: 5, fix: 'Show real owner stories or independent rankings. Keep them free of earnings claims.',
    test: p => /testimonial|franchisee (stories|spotlight|success|reviews?)|hear from|what (our|other) (franchisees|owners)|our (franchisees|owners) say|franchise business review|franchise 500|top franchise|ranked/i.test(p.text) },
  { id: 'process', label: 'The steps to ownership', weight: 5, fix: 'Lay out the steps from first call to signed agreement, so candidates know what to expect.',
    test: p => /discovery day|steps? to (owner|franchise|becom|get|join)|the process|how it works|path to ownership|franchise process|our process|road to ownership/i.test(p.text) },
  { id: 'video', label: 'A video', weight: 5, fix: 'Add a short video from leadership or an owner.',
    test: p => /youtube(-nocookie)?\.com|youtu\.be|vimeo\.com|wistia|vidyard|brightcove|<video\b/i.test(p.html) },
  { id: 'https', label: 'A secure site (HTTPS)', weight: 3, fix: 'Serve the page over HTTPS.', test: p => p.url.startsWith('https:') },
  { id: 'mobile', label: 'Built for phones', weight: 2, fix: 'Add a responsive layout with a mobile viewport tag.', test: p => /<meta[^>]+name=["']viewport["']/i.test(p.html) },
];

function analyze(html, url) {
  const page = { html: String(html), text: toText(html), url };
  const checks = CHECKS.map(c => ({ id: c.id, label: c.label, weight: c.weight, pass: !!c.test(page), fix: c.fix, benchmark: c.benchmark || null }));
  const earned = checks.reduce((n, c) => n + (c.pass ? c.weight : 0), 0);
  const fixes = checks.filter(c => !c.pass).sort((a, b) => b.weight - a.weight).slice(0, 3).map(c => ({ id: c.id, label: c.label, fix: c.fix }));
  return { score: earned, label: earned >= 80 ? 'Strong' : earned >= 60 ? 'Solid, with gaps' : earned >= 40 ? 'Leaking candidates' : 'Needs work', checks, fixes, words: page.text.split(' ').length };
}

function isDevPage(html, url) {
  const text = toText(html).toLowerCase();
  const count = (text.match(/franchis/g) || []).length;
  const pathHit = /franchis|ownership|own-a|become-an?-owner|opportunit/i.test(new URL(url).pathname + new URL(url).hostname);
  return (pathHit && count >= 2) || (count >= 6 && /investment|territor|franchise fee|ownership|own a|franchise opportunit/.test(text));
}

function findDevLink(html, baseUrl) {
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m, best = null, bestScore = 0;
  while ((m = re.exec(html))) {
    let abs;
    try { abs = new URL(m[1], baseUrl); } catch (e) { continue; }
    if (abs.protocol !== 'https:' && abs.protocol !== 'http:') continue;
    if (/\.(pdf|jpe?g|png|zip)(\?|$)/i.test(abs.pathname)) continue;
    const text = toText(m[2]).toLowerCase();
    const href = (abs.hostname + abs.pathname).toLowerCase();
    let score = 0;
    if (/franchis/.test(text)) score += 4;
    if (/own (a|your)|become an? (owner|franchisee)|ownership/.test(text)) score += 3;
    if (/opportunit/.test(text)) score += 1;
    if (/franchis/.test(href)) score += 3;
    if (/own-a|ownership|become-an?-owner/.test(href)) score += 2;
    if (/(find|locat|menu|careers?|login|news|blog)/.test(text)) score -= 3;
    if (/franchisee[- ](login|portal)|intranet/.test(text + href)) score -= 6;
    if (score > bestScore) { bestScore = score; best = abs.toString(); }
  }
  return bestScore >= 3 ? best : null;
}

const SUBPAGE = /invest|cost|fee|territor|market|availab|process|steps|qualif|ideal|requirement|faq|why|contact|inquir|enquir|request|apply|get-started|testimonial|stories|ownership/i;

function findSubpages(html, baseUrl, limit) {
  const base = new URL(baseUrl);
  const baseKey = base.origin + base.pathname.replace(/\/$/, '');
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set(), found = [];
  let m;
  while ((m = re.exec(html))) {
    let abs;
    try { abs = new URL(m[1], baseUrl); } catch (e) { continue; }
    if (abs.hostname !== base.hostname || !/^https?:$/.test(abs.protocol)) continue;
    if (/\.(pdf|jpe?g|png|zip|webp|svg)(\?|$)/i.test(abs.pathname)) continue;
    abs.search = ''; abs.hash = '';
    const key = abs.origin + abs.pathname.replace(/\/$/, '');
    if (key === baseKey || seen.has(key)) continue;
    if (/(login|privacy|terms|blog|news|career|cookie|sitemap)/i.test(abs.pathname)) continue;
    if (!SUBPAGE.test(abs.pathname + ' ' + toText(m[2]))) continue;
    seen.add(key);
    found.push(abs.toString());
  }
  return found.slice(0, limit);
}

function robotsAllows(txt, path) {
  let applies = false, sawAgent = false, disallow = [], allow = [];
  String(txt).split(/\r?\n/).forEach(line => {
    const m = line.replace(/#.*/, '').match(/^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i);
    if (!m) return;
    const key = m[1].toLowerCase(), val = m[2];
    if (key === 'user-agent') {
      if (!sawAgent) applies = false;
      sawAgent = true;
      if (val === '*' || /zehaanai/i.test(val)) applies = true;
    } else {
      sawAgent = false;
      if (!applies || !val) return;
      if (key === 'disallow') disallow.push(val);
      if (key === 'allow') allow.push(val);
    }
  });
  const match = rules => rules.reduce((n, r) => (path.startsWith(r.replace(/\*.*$/, '')) ? Math.max(n, r.length) : n), -1);
  return match(disallow) <= match(allow) || match(disallow) === -1;
}

async function gradeSite(input, opts) {
  opts = opts || {};
  const get = opts.fetchPage || fetchPage;
  const started = normalizeUrl(input);
  const timeout = opts.timeoutMs || 4000;
  const out = { ok: false, inputUrl: started, gradedAt: new Date().toISOString() };

  const allowed = async url => {
    if (!opts.respectRobots) return true;
    try {
      const u = new URL(url);
      const r = await get(u.origin + '/robots.txt', timeout);
      return r.status >= 400 || robotsAllows(r.html, u.pathname);
    } catch (e) { return true; }
  };

  if (!(await allowed(started))) return { ...out, reason: 'robots' };
  let page;
  try { page = await get(started, timeout); } catch (e) { return { ...out, reason: e.message === 'blocked_host' ? 'blocked_host' : e.message === 'not_html' ? 'not_html' : 'unreachable' }; }
  if (page.status >= 400 || !page.html) return { ...out, reason: page.status === 403 || page.status === 429 ? 'blocked' : 'unreachable' };

  let target = page, devFound = isDevPage(page.html, page.url);
  if (!devFound) {
    const link = findDevLink(page.html, page.url);
    if (link && (await allowed(link))) {
      try {
        const dev = await get(link, timeout);
        if (dev.status < 400 && dev.html) { target = dev; devFound = true; }
      } catch (e) { /* fall back to the page we have */ }
    }
  }

  let combined = target.html, pages = 1;
  const links = findSubpages(target.html, target.url, opts.maxSubpages == null ? 3 : opts.maxSubpages);
  const extra = await Promise.all(links.map(async link => {
    try {
      if (!(await allowed(link))) return null;
      const p = await get(link, Math.min(timeout, opts.subTimeoutMs || 3000));
      return p.status < 400 && p.html ? p.html : null;
    } catch (e) { return null; }
  }));
  extra.filter(Boolean).forEach(h => { combined += '\n' + h; pages++; });

  const result = analyze(combined, target.url);
  if (result.words < 120) return { ...out, gradedUrl: target.url, reason: 'unreadable' };
  return { ...out, ok: true, gradedUrl: target.url, devPageFound: devFound, pagesRead: pages, score: result.score, label: result.label, checks: result.checks, fixes: result.fixes };
}

module.exports = { findSubpages, UA, isPrivateIP, normalizeUrl, toText, analyze, isDevPage, findDevLink, robotsAllows, gradeSite, fetchPage, CHECKS };
