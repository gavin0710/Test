import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import access from './lib/site-access.cjs';

process.chdir(fileURLToPath(new URL('.', import.meta.url)));
const password = randomBytes(20).toString('hex');
const salt = randomBytes(16).toString('hex');
process.env.MACD_ACCESS_PASSWORD_HASH = `scrypt-v1$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
process.env.MACD_ACCESS_SESSION_SECRET = randomBytes(32).toString('base64url');
const originalHash = process.env.MACD_ACCESS_PASSWORD_HASH;
const handler = (await import('./api/access.js')).default;
const latest = (await import('./api/latest.js')).default;
const history = (await import('./api/history.js')).default;
const routes = JSON.parse(readFileSync('vercel.json')).routes;
const realFetch = globalThis.fetch;
let upstreamCalls = 0;
globalThis.fetch = async (url, ...args) => {
  if (String(url).startsWith('https://raw.')) {
    upstreamCalls++;
    const name = new URL(url).pathname.split('/').pop();
    return new Response(readFileSync(resolve('data', name)), { headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(url, ...args);
};

const server = createServer(async (req, res) => {
  res.status = value => { res.statusCode = value; return res; };
  res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return res; };
  res.send = value => { res.end(value); return res; };
  const url = new URL(req.url, 'http://localhost');
  const route = routes.find(r => new RegExp('^' + r.src + '$').test(url.pathname));
  const target = url.pathname.replace(new RegExp('^' + route.src + '$'), route.dest);
  const rewritten = new URL(target, url);
  req.query = Object.fromEntries([...url.searchParams, ...rewritten.searchParams]);
  let body = '';
  for await (const chunk of req) body += chunk;
  req.body = body;
  try {
    await (rewritten.pathname === '/api/latest' ? latest : rewritten.pathname === '/api/history' ? history : handler)(req, res);
  } catch (error) { res.statusCode = 500; res.end('Test handler failed'); console.error(error); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const get = (path, cookie, options = {}) => realFetch(origin + path, { redirect: 'manual', ...options, headers: { ...(cookie ? { cookie } : {}), ...options.headers } });
const login = (value, options = {}) => get('/_access/login', null, { method: 'POST', body: new URLSearchParams({ password: value, next: options.next || '/' }), headers: { Origin: options.origin || origin, 'x-vercel-forwarded-for': options.ip || 'test-user' } });

try {
  for (const path of ['/', '/index.html', '/analysis.html', '/analysis']) {
    const response = await get(path);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /name="password"/);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
  }
  for (const path of ['/api/latest', '/api/history?period=15', '/api/history?period=101', '/api/history?period=102', '/analysis-metrics.js', '/analysis-data.json', '/index', '/index.html/', '/api/access?__path=index.html', '/lib/site-access.cjs', '/vercel.json']) {
    const response = await get(path);
    assert.equal(response.status, 401, path);
    assert.doesNotMatch(await response.text(), /buildLedger|MACD_ACCESS_|signalStats/);
  }
  assert.equal(upstreamCalls, 0, 'Unauthenticated requests must not fetch data');
  assert.equal((await login('wrong')).status, 401);
  assert.equal((await login(password, { origin: 'https://outside.example' })).status, 403);
  assert.equal((await get('/_access/login', null, { method: 'POST', body: 'password=x' })).status, 403);
  assert.equal((await get('/_access/login', null, { method: 'POST', body: '{}', headers: { Origin: origin, 'Content-Type': 'application/json' } })).status, 415);
  const granted = await login(password, { next: '/analysis.html' });
  assert.equal(granted.status, 303);
  assert.equal(granted.headers.get('Location'), '/analysis.html');
  const cookieHeader = granted.headers.get('Set-Cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=604800']) assert(cookieHeader.includes(flag));
  const cookie = cookieHeader.split(';')[0];
  for (const path of ['/', '/index.html', '/analysis.html', '/analysis-metrics.js', '/analysis-data.json']) {
    const response = await get(path, cookie);
    assert.equal(response.status, 200, path);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), readFileSync(path === '/' ? 'index.html' : path.slice(1)), path);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
  }
  for (const path of ['/api/latest', '/api/history?period=15', '/api/history?period=101', '/api/history?period=102']) {
    const response = await get(path, cookie);
    assert.equal(response.status, 200, path);
    assert.equal((await response.json()).data.length, 4, path);
  }
  assert.equal(upstreamCalls, 4);
  assert.equal((await get('/api/history?period=invalid', cookie)).status, 400);
  const head = await get('/', cookie, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await get('/vercel.json', cookie)).status, 404);
  assert.equal((await get('/lib/site-access.cjs', cookie)).status, 404);
  assert.equal((await get('/api/latest', cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a'))).status, 401);
  const request = { headers: { cookie } };
  assert(access.authenticated(request));
  assert(!access.authenticated(request, Date.now() + 8 * 86400000));
  process.env.MACD_ACCESS_PASSWORD_HASH = originalHash.replace(salt, randomBytes(16).toString('hex'));
  assert(!access.authenticated(request), 'Changing password invalidates existing sessions');
  process.env.MACD_ACCESS_PASSWORD_HASH = originalHash;
  for (let n = 0; n < 5; n++) assert.equal((await login('wrong', { ip: 'throttle-user' })).status, 401);
  const limited = await login(password, { ip: 'throttle-user' });
  assert.equal(limited.status, 429);
  assert(Number(limited.headers.get('Retry-After')) > 0);
  assert.equal((await login(password, { next: 'https://outside.example' })).headers.get('Location'), '/');
  const logout = await get('/_access/logout', cookie, { method: 'POST', headers: { Origin: origin } });
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
  delete process.env.MACD_ACCESS_SESSION_SECRET;
  assert.equal((await get('/')).status, 503);
  assert.equal((await get('/api/latest', cookie)).status, 401);
  console.log('PASS: password gate, assets, APIs, cookies, expiry, rotation, origin checks, throttling and fail-closed configuration');
} finally {
  globalThis.fetch = realFetch;
  await new Promise(resolve => server.close(resolve));
}
