#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = new URL(process.env.MACD_BASE_URL || 'https://macd-resonance-monitor.vercel.app');
const files = ['index.html', 'analysis.html', 'analysis-metrics.js', 'analysis-data.json'];
let cookie = '';
if (process.env.MACD_SITE_PASSWORD) {
  const login = await fetch(new URL('/_access/login', base), {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { Origin: base.origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.MACD_SITE_PASSWORD, next: '/' })
  });
  assert.equal(login.status, 303, 'Production password login failed');
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert(cookie, 'Production login did not issue a session');
}
for (let attempt = 1; attempt <= 12; attempt++) {
  let matches = true;
  for (const file of files) {
    const response = await fetch(new URL(file === 'index.html' ? '/' : '/' + file, base), {
      headers: cookie ? { Cookie: cookie } : {}, cache: 'no-store', signal: AbortSignal.timeout(30000)
    });
    assert.equal(response.status, 200, 'Production resource unavailable: ' + file);
    const actual = Buffer.from(await response.arrayBuffer());
    if (file === 'index.html' && actual.toString().includes('name="password"')) {
      throw Error('Production is password protected; configure the MACD_SITE_PASSWORD Actions secret. A login page HTTP 200 is not dashboard acceptance.');
    }
    if (!actual.equals(readFileSync(new URL(file, import.meta.url)))) {
      matches = false;
      break;
    }
  }
  if (matches) {
    console.log('PRODUCTION_FILES_MATCH', files.map(file => ({ file,
      sha256: createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex') })));
    process.exit(0);
  }
  if (attempt < 12) await new Promise(resolve => setTimeout(resolve, 5000));
}
throw Error('The production alias does not serve this tested revision.');
