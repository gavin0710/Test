const { createHmac, randomBytes, scrypt: derive, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(derive);
const COOKIE = '__Host-macd-access';
const TTL = 7 * 24 * 60 * 60;
const failures = new Map();

function settings() {
  const hash = process.env.MACD_ACCESS_PASSWORD_HASH || '';
  const key = process.env.MACD_ACCESS_SESSION_SECRET || '';
  const match = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(hash);
  return match && key.length >= 43 ? { hash, key, salt: match[1], digest: match[2] } : null;
}

function headers(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
}

function signature(value, config) {
  return createHmac('sha256', config.key).update(config.hash + '\n' + value).digest('base64url');
}

function equal(a, b) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function authenticated(req, now = Date.now()) {
  const config = settings();
  if (!config) return false;
  const cookies = String(req.headers.cookie || '').split(';').map(s => s.trim());
  const token = cookies.find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
  const match = /^(\d{10})\.([a-f0-9]{32})\.([\w-]{43})$/.exec(token);
  if (!match) return false;
  const expiry = Number(match[1]), seconds = Math.floor(now / 1000);
  return expiry > seconds && expiry <= seconds + TTL && equal(match[3], signature(match[1] + '.' + match[2], config));
}

function authorize(req, res) {
  headers(res);
  if (authenticated(req)) return true;
  res.status(401).json({ error: '请先输入访问密码', login: '/' });
  return false;
}

function sessionCookie(now = Date.now()) {
  const config = settings();
  if (!config) throw Error('Access settings missing');
  const value = Math.floor(now / 1000) + TTL + '.' + randomBytes(16).toString('hex');
  return `${COOKIE}=${value}.${signature(value, config)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL}`;
}

function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

async function checkPassword(value) {
  const config = settings();
  if (!config || typeof value !== 'string' || value.length > 256) return false;
  const digest = await scrypt(value, config.salt, 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(digest, Buffer.from(config.digest, 'hex'));
}

// Best-effort per-instance throttle. Vercel's infrastructure also applies its
// platform firewall; this is not a global, persistent rate-limit database.
function clientKey(req) {
  const ip = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  return createHmac('sha256', settings()?.key || 'unconfigured').update(ip).digest('hex');
}

function retryAfter(req, now = Date.now()) {
  const record = failures.get(clientKey(req));
  return record && record.until > now ? Math.ceil((record.until - now) / 1000) : 0;
}

function recordFailure(req, now = Date.now()) {
  for (const [key, value] of failures) if (value.reset < now) failures.delete(key);
  if (failures.size > 10000) failures.delete(failures.keys().next().value);
  const key = clientKey(req), previous = failures.get(key);
  const count = (previous?.reset > now ? previous.count : 0) + 1;
  failures.set(key, { count, until: count >= 5 ? now + 60000 : 0, reset: now + 15 * 60000 });
}

function resetFailures(req) { failures.delete(clientKey(req)); }

function safeNext(value) {
  if (value === '/analysis') return '/analysis.html';
  return require('./analysis-resources.cjs').pages.some(page => value === '/' + page) ? value : '/';
}

function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function loginPage(next = '/', message = '') {
  // All substitutions below come from a fixed allowlist or server messages.
  next = safeNext(next);
  const messages = {
    wrong: '密码不正确，请重新输入。',
    limited: '尝试次数较多，请稍后再试。',
    unavailable: '访问服务暂不可用，请稍后重试。',
    invalid: '请求已失效，请重新输入。'
  };
  const notice = messages[message] || '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>访问验证 · 四指共振</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#f5f7fa;color:#172b45;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}.card{width:min(100%,390px);padding:34px 30px;background:#fff;border:1px solid #e2e8f0;border-radius:20px;box-shadow:0 16px 48px #243b5810}.mark{width:44px;height:44px;display:grid;place-items:center;border-radius:14px;background:#eaf1ff;color:#2859a8;margin-bottom:22px}h1{font-size:24px;letter-spacing:-.5px;margin:0 0 6px}p{color:#6b7b90;margin:0 0 24px}label{display:block;font-size:13px;font-weight:600;margin:0 0 8px}input{width:100%;padding:13px 14px;border:1px solid #ccd6e2;border-radius:10px;font:inherit;background:#fbfcfe;outline:none}input:focus{border-color:#366cbb;box-shadow:0 0 0 3px #366cbb18}button{width:100%;margin-top:16px;padding:13px;border:0;border-radius:10px;background:#244f88;color:#fff;font:inherit;font-weight:600;cursor:pointer}button:hover{background:#1c426f}button:focus-visible{outline:3px solid #8bb7f0;outline-offset:3px}.notice{min-height:24px;margin:10px 0 0;color:#ad3939;font-size:13px}.hint{margin:16px 0 0;font-size:12px;text-align:center;color:#7f8da0}@media(max-width:420px){.card{padding:28px 24px}}
  </style></head><body><main class="card"><div class="mark" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 018 0v3M12 14v3"/></svg></div><h1>四指共振</h1><p>输入访问密码，进入研究看板。</p><form method="post" action="/_access/login"><input type="hidden" name="next" value="${next}"><label for="password">访问密码</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required autofocus aria-describedby="notice"><p id="notice" class="notice" role="alert">${notice}</p><button type="submit">进入看板</button></form><p class="hint">验证后 7 天内免重复输入</p></main></body></html>`;
}

module.exports = { settings, headers, authenticated, authorize, sessionCookie, clearCookie, checkPassword, retryAfter, recordFailure, resetFailures, safeNext, sameOrigin, loginPage };
