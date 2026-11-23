import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

test('API exposes public configuration without secrets and requires authentication for private routes', async t => {
  process.env.SUPABASE_URL = 'https://example.supabase.co'; process.env.SUPABASE_PUBLISHABLE_KEY = 'public-test-key';
  process.env.SUPABASE_SECRET_KEY = 'private-database-secret'; process.env.ONLINECOMPILER_API_KEY = 'private-compiler-secret';
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = await fetch(`${base}/api/config`); const raw = await config.text();
  assert.equal(config.status, 200); assert.ok(raw.includes('public-test-key'));
  assert.ok(!raw.includes('private-database-secret')); assert.ok(!raw.includes('private-compiler-secret'));
  assert.equal(config.headers.get('x-content-type-options'), 'nosniff');
  for (const [route, method] of [['/run', 'POST'], ['/stress', 'POST'], ['/solutions', 'GET'], ['/profile', 'PATCH'], ['/history', 'GET'], ['/whiteboards', 'GET'], ['/whiteboards', 'POST'], ['/whiteboards/private-board', 'GET'], ['/whiteboards/private-board', 'DELETE'], ['/stress/someone-elses-job', 'GET']]) {
    const response = await fetch(`${base}/api${route}`, { method, headers: { 'Content-Type': 'application/json' }, ...(method !== 'GET' ? { body: '{}' } : {}) });
    assert.equal(response.status, 401, `${method} ${route} requires auth`);
  }
  const invalid = await fetch(`${base}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(invalid.status, 400);
});
