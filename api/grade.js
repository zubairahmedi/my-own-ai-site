const { gradeSite } = require('./_grade-core.js');

const ORIGINS = new Set(['https://zehaanai.com', 'https://www.zehaanai.com']);
const hits = new Map();
const LIMIT = 20;
const WINDOW = 3600000;

function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > LIMIT;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });
  if (!ORIGINS.has(req.headers.origin)) return res.status(403).json({ ok: false, reason: 'origin' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ ok: false, reason: 'rate_limited' });
  const url = req.body && typeof req.body.url === 'string' ? req.body.url : '';
  try {
    return res.status(200).json(await gradeSite(url, { timeoutMs: 4000 }));
  } catch (e) {
    return res.status(200).json({ ok: false, reason: e.message === 'blocked_host' ? 'blocked_host' : 'bad_url' });
  }
};
