import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import access from '../lib/site-access.cjs';

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/analysis': ['analysis.html', 'text/html; charset=utf-8'],
  '/analysis.html': ['analysis.html', 'text/html; charset=utf-8'],
  '/analysis-metrics.js': ['analysis-metrics.js', 'application/javascript; charset=utf-8'],
  '/analysis-data.json': ['analysis-data.json', 'application/json; charset=utf-8']
};
const fileCache = new Map();

function page(res, status, next, message) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  return res.status(status).send(access.loginPage(next, message));
}

export default async function handler(req, res) {
  access.headers(res);
  const route = req.query?.__path;
  const path = typeof route === 'string' ? '/' + route : '/';
  const next = access.safeNext(path);
  if (!access.settings()) return page(res, 503, next, 'unavailable');

  if (path === '/_access/login') {
    if (req.method !== 'POST') return res.status(303).setHeader('Location', '/').end();
    if (!access.sameOrigin(req)) return page(res, 403, '/', 'invalid');
    if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) return res.status(415).end();
    // Vercel parses URL-encoded form bodies. The byte limit also covers the
    // local test server, where the body is still a string.
    if (Number(req.headers['content-length'] || 0) > 2048) return res.status(413).end();
    const body = typeof req.body === 'string' || Buffer.isBuffer(req.body)
      ? Object.fromEntries(new URLSearchParams(String(req.body))) : req.body || {};
    if (Buffer.byteLength(JSON.stringify(body)) > 2048) return res.status(413).end();
    const destination = access.safeNext(body.next);
    const retry = access.retryAfter(req);
    if (retry) {
      res.setHeader('Retry-After', String(retry));
      return page(res, 429, destination, 'limited');
    }
    if (!(await access.checkPassword(body.password))) {
      access.recordFailure(req);
      return page(res, 401, destination, 'wrong');
    }
    access.resetFailures(req);
    res.setHeader('Set-Cookie', access.sessionCookie());
    res.setHeader('Location', destination);
    return res.status(303).end();
  }

  if (path === '/_access/logout') {
    if (req.method !== 'POST') return res.status(405).setHeader('Allow', 'POST').end();
    if (!access.sameOrigin(req)) return page(res, 403, '/', 'invalid');
    res.setHeader('Set-Cookie', access.clearCookie());
    res.setHeader('Location', '/');
    return res.status(303).end();
  }

  if (!access.authenticated(req)) {
    if (['/', '/index.html', '/analysis', '/analysis.html'].includes(path)) return page(res, 200, next);
    return res.status(401).json({ error: '请先输入访问密码', login: '/' });
  }
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).setHeader('Allow', 'GET, HEAD').end();
  const entry = files[path];
  if (!entry) return res.status(404).end();
  if (!fileCache.has(entry[0])) fileCache.set(entry[0], readFileSync(join(process.cwd(), entry[0])));
  res.setHeader('Content-Type', entry[1]);
  return req.method === 'HEAD' ? res.status(200).end() : res.status(200).send(fileCache.get(entry[0]));
}
