import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { stressSchema } from '../server/validation.js';

const owner = '11111111-1111-4111-8111-111111111111';
const config = () => stressSchema.parse({
  brute: { language: 'python', code: 'reference' }, optimized: { language: 'python', code: 'reference' },
  generator: { type: 'pairs', minValue: -10, maxValue: 10 }, iterations: 2, seed: 42,
});

test('Vercel adapter routes API requests and stress cases survive changing instances', async t => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
  process.env.SUPABASE_SECRET_KEY = 'secret-test-key';
  process.env.ONLINECOMPILER_API_KEY = 'compiler-test-key';
  const realFetch = globalThis.fetch;
  const compilations = []; const savedRows = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin === 'https://example.supabase.co' && url.pathname === '/auth/v1/user') {
      const headers = new Headers(options?.headers);
      return headers.get('authorization') === 'Bearer valid-session'
        ? Response.json({ id: owner, aud: 'authenticated', role: 'authenticated', email: 'test@example.com', user_metadata: {} })
        : Response.json({ message: 'Invalid token' }, { status: 401 });
    }
    if (url.origin === 'https://api.onlinecompiler.io') {
      const data = JSON.parse(options.body); compilations.push(data);
      assert.equal(new Headers(options.headers).get('authorization'), 'compiler-test-key');
      const sum = data.input.trim().split(/\s+/).reduce((a, n) => a + Number(n), 0);
      return Response.json({ output: String(data.code === 'wrong' ? sum + 1 : sum), error: '', status: 'success', exit_code: 0, time: '0.01', memory: '2048' });
    }
    if (url.origin === 'https://example.supabase.co' && url.pathname === '/rest/v1/stress_runs') {
      const row = JSON.parse(options.body); savedRows.push(row);
      assert.equal(new Headers(options.headers).get('authorization'), 'Bearer valid-session');
      return Response.json(row);
    }
    return realFetch(input, options);
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const { default: handler } = await import('../api/index.js');
  const servers = [createServer(handler), createServer(createApp({ serverless: true, serveFrontend: false }))];
  for (const server of servers) {
    server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
  }
  const bases = servers.map(server => `http://127.0.0.1:${server.address().port}`);
  const request = (instance, path, method = 'GET', body, token = 'valid-session') => realFetch(
    `${bases[instance]}${instance === 0 ? `/api/index?__api_path=${encodeURIComponent(path)}` : `/api/${path}`}`,
    { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Forwarded-For': '203.0.113.10' }, ...(body ? { body: JSON.stringify(body) } : {}) },
  );
  const publicConfig = await request(0, 'config');
  assert.equal(publicConfig.status, 200); assert.equal(publicConfig.headers.get('cache-control'), 'no-store');
  const rawConfig = await publicConfig.text();
  assert.equal(JSON.parse(rawConfig).stressMode, 'stepped');
  assert.ok(!rawConfig.includes('secret-test-key')); assert.ok(!rawConfig.includes('compiler-test-key'));
  assert.deepEqual(await (await request(0, 'health')).json(), { status: 'ok' });
  assert.equal((await request(0, 'stress/step', 'POST', { config: config(), iteration: 1 }, 'invalid-session')).status, 401);
  assert.equal((await request(0, 'stress', 'POST', config())).status, 409);
  const first = await request(0, 'stress/step', 'POST', { config: config(), iteration: 1 });
  assert.equal(first.status, 200); const firstResult = await first.json(); assert.equal(firstResult.status, 'passed');
  const second = await request(1, 'stress/step', 'POST', { config: config(), iteration: 2 });
  assert.equal(second.status, 200); const secondResult = await second.json(); assert.equal(secondResult.log.iteration, 2);
  const secondInput = compilations.at(-1).input;
  await request(0, 'stress/step', 'POST', { config: config(), iteration: 2 });
  assert.equal(compilations.at(-1).input, secondInput, 'resuming a case on a new instance reproduces its input');
  const bad = config(); bad.optimized.code = 'wrong';
  const mismatch = await (await request(0, 'stress/step', 'POST', { config: bad, iteration: 1 })).json();
  assert.equal(mismatch.status, 'mismatch'); assert.ok(mismatch.counterexample.input);
  assert.notEqual(mismatch.counterexample.brute.output, mismatch.counterexample.optimized.output);
  assert.equal((await request(0, 'stress/step', 'POST', { config: config(), iteration: 3 })).status, 400);
  const finished = {
    id: '22222222-2222-4222-8222-222222222222', status: 'passed', completed: 2, total: 2, seed: 42,
    startedAt: 1000, finishedAt: 2000, logs: [firstResult.log, secondResult.log], counterexample: null, error: null,
  };
  const saved = await request(1, 'stress/save', 'POST', { config: config(), result: finished, user_id: 'another-user' });
  assert.equal(saved.status, 200); assert.equal(savedRows[0].user_id, owner);
  assert.equal((await request(0, 'stress/save', 'POST', { config: config(), result: { ...finished, status: 'running' } })).status, 400);
  assert.equal((await request(0, 'unknown/nested/route')).status, 404);
});

test('missing hosting environment variables produce a useful configuration error', async t => {
  const previous = process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  t.after(() => { if (previous === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = previous; });
  const server = createApp({ serverless: true, serveFrontend: false }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/config`);
  assert.equal(response.status, 503); assert.match((await response.json()).error, /SUPABASE_PUBLISHABLE_KEY/);
});
