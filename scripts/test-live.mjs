import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createApp } from '../server/app.js';
import { stressSchema } from '../server/validation.js';

// Explicit opt-in integration test. Creates temporary confirmed accounts without sending
// email, exercises real authenticated compilation, then deletes the accounts in finally.
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const created = [];
const server = createApp().listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
async function user() {
  const email = `awb-test-${randomUUID()}@example.com`; const password = `${randomUUID()}!Aa9`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: 'integration_test' } });
  if (error) throw new Error(`Temporary account creation failed: ${error.message}`);
  created.push(data.user.id);
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await db.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return signedIn.data.session.access_token;
}
async function request(token, route, method = 'GET', body) {
  const response = await fetch(`${base}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function waitForJob(token, id) {
  for (let i = 0; i < 100; i++) {
    const response = await request(token, `/stress/${id}`);
    assert.equal(response.status, 200);
    if (response.body.status !== 'running') return response.body;
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  throw new Error('Stress job did not finish in one minute.');
}
try {
  const token = await user(); const otherToken = await user();
  console.log('Supabase: temporary accounts created and password sign-in verified.');
  const programs = {
    cpp: '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b;}',
    python: 'a,b=map(int,input().split())\nprint(a+b)',
    javascript: "const [a,b]=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);console.log(a+b);",
    java: 'import java.util.*;public class Main{public static void main(String[] args){Scanner s=new Scanner(System.in);System.out.println(s.nextLong()+s.nextLong());}}',
    c: '#include <stdio.h>\nint main(){long long a,b;scanf("%lld%lld",&a,&b);printf("%lld",a+b);}',
  };
  for (const [language, code] of Object.entries(programs)) {
    const r = await request(token, '/run', 'POST', { language, code, input: '7 8\n' });
    assert.equal(r.status, 200, `${language}: ${r.body.error}`); assert.equal(r.body.output.trim(), '15', `${language} output`);
    console.log(`IDE: ${language} compilation and custom input passed.`);
  }
  const runtimeError = await request(token, '/run', 'POST', { language: 'python', code: 'raise RuntimeError("integration check")' });
  assert.equal(runtimeError.status, 200); assert.notEqual(runtimeError.body.exitCode, 0); assert.match(runtimeError.body.error, /integration check/);
  console.log('IDE: runtime error reporting verified.');
  const cfg = stressSchema.parse({ brute: { language: 'python', code: programs.python }, optimized: { language: 'python', code: 'print(-999999999999)' }, generator: { type: 'pairs', minValue: 0, maxValue: 10 }, iterations: 2, seed: 42 });
  const started = await request(token, '/stress', 'POST', cfg); assert.equal(started.status, 202);
  assert.equal((await request(otherToken, `/stress/${started.body.id}`)).status, 404);
  assert.equal((await request(otherToken, `/stress/${started.body.id}`, 'DELETE')).status, 404);
  const mismatch = await waitForJob(token, started.body.id);
  assert.equal(mismatch.status, 'mismatch'); assert.equal(mismatch.completed, 1); assert.ok(mismatch.counterexample.input);
  console.log('Stress: real mismatch detected; cross-user access and cancellation denied.');
  cfg.optimized = cfg.brute; cfg.iterations = 1;
  const matching = await request(token, '/stress', 'POST', cfg); assert.equal(matching.status, 202);
  assert.equal((await waitForJob(token, matching.body.id)).status, 'passed');
  console.log('Stress: matching solutions passed with real remote execution.');
  const caseResult = await request(token, '/stress/step', 'POST', { config: cfg, iteration: 1 });
  assert.equal(caseResult.status, 200); assert.equal(caseResult.body.status, 'passed');
  assert.equal(caseResult.body.log.iteration, 1);
  console.log('Stress: stateless serverless case execution passed with the real compiler.');
  const profile = await request(token, '/profile');
  if (profile.status === 503) console.log('Persistence: not tested; database migration is pending.');
  else {
    assert.equal(profile.status, 200);
    const saved = await request(token, '/solutions', 'POST', { title: 'Integration test', language: 'python', code: programs.python, input: '7 8' });
    assert.equal(saved.status, 201); const id = saved.body.id;
    assert.equal((await request(otherToken, `/solutions/${id}`)).status, 404);
    console.log('Persistence: saved solution and cross-user isolation verified.');
  }
} finally {
  for (const id of created) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) { console.error(`Temporary account cleanup failed: ${error.message}`); process.exitCode = 1; }
  }
  await new Promise(resolve => server.close(resolve));
  console.log(`Cleaned up ${created.length} temporary test accounts.`);
}
