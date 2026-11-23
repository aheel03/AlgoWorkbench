import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerator, compareOutputs, createJob, publicJob, runStress, runStressCase } from '../server/stress.js';
import { normalizeResult } from '../server/compiler.js';
import { stressSchema, runSchema } from '../server/validation.js';

const result = (output, overrides = {}) => ({ output, error: '', status: 'success', exitCode: 0, time: 0.01, memory: 1024, truncated: false, ...overrides });
const config = (overrides = {}) => stressSchema.parse({
  brute: { language: 'cpp', code: 'reference' }, optimized: { language: 'cpp', code: 'candidate' },
  generator: { type: 'array', minSize: 1, maxSize: 5, minValue: -10, maxValue: 10 },
  iterations: 5, seed: 42, ...overrides,
});

test('built-in arrays are reproducible, well-formed, and within configured bounds', () => {
  const settings = { type: 'array', minSize: 1, maxSize: 15, minValue: -7, maxValue: 4 };
  const a = createGenerator(settings, 4294967295); const b = createGenerator(settings, 4294967295);
  for (let i = 0; i < 100; i++) {
    const input = a(); assert.equal(input, b()); const [n, ...values] = input.trim().split(/\s+/).map(Number);
    assert.equal(values.length, n); assert.ok(n >= 1 && n <= 15); assert.ok(values.every(v => v >= -7 && v <= 4));
  }
});
test('pair generator accepts negative values and degenerate ranges', () => {
  assert.equal(createGenerator({ type: 'pairs', minValue: -4, maxValue: -4 }, 0)(), '-4 -4\n');
});
test('token and exact comparisons preserve intended whitespace semantics', () => {
  assert.ok(compareOutputs('  1  2\n3\n', '1\n2\t3'));
  assert.ok(compareOutputs('', '\n \t'));
  assert.ok(!compareOutputs('1 2', '12'));
  assert.ok(!compareOutputs('1\n', '1', 'exact'));
  assert.ok(compareOutputs('1\r\n', '1\n', 'exact'));
});
test('stress stops on the first mismatch and preserves the counterexample', async () => {
  const job = createJob('owner', config()); let calls = 0;
  await runStress(job, async program => { calls++; return result(program.code === 'reference' ? '12' : '13'); });
  assert.equal(job.status, 'mismatch'); assert.equal(job.completed, 1); assert.equal(calls, 2);
  assert.equal(job.counterexample.brute.output, '12'); assert.equal(job.counterexample.optimized.output, '13');
  assert.ok(job.counterexample.input); assert.equal(job.logs.length, 1);
});
test('all matching cases finish successfully', async () => {
  const job = createJob('owner', config()); await runStress(job, async () => result('42\n'));
  assert.equal(job.status, 'passed'); assert.equal(job.completed, 5); assert.equal(job.counterexample, null);
});
test('runtime errors cannot be reported as matching output', async () => {
  const job = createJob('owner', config());
  await runStress(job, async p => result('', p.code === 'candidate' ? { status: 'error', exitCode: 124, error: 'Time limit exceeded' } : {}));
  assert.equal(job.status, 'error'); assert.equal(job.counterexample.role, 'optimized');
});
test('truncated output is never treated as a pass', async () => {
  const job = createJob('owner', config()); await runStress(job, async () => result('42', { truncated: true }));
  assert.equal(job.status, 'error');
});
test('custom generator receives seed and iteration; output feeds both solutions', async () => {
  const cfg = config({ iterations: 2, generator: { type: 'custom', program: { language: 'python', code: 'generator' } } });
  const inputs = []; const job = createJob('owner', cfg);
  await runStress(job, async (program, input) => {
    inputs.push([program.code, input]); return result(program.code === 'generator' ? '2\n5 7\n' : '12');
  });
  assert.deepEqual(inputs.filter(([p]) => p === 'generator').map(([, input]) => input), ['42 1\n', '42 2\n']);
  assert.ok(inputs.filter(([p]) => p !== 'generator').every(([, input]) => input === '2\n5 7\n'));
  assert.equal(job.status, 'passed');
});
test('custom generator failure prevents solution execution', async () => {
  const job = createJob('owner', config({ generator: { type: 'custom', program: { language: 'python', code: 'generator' } } })); let calls = 0;
  await runStress(job, async () => { calls++; return result('', { status: 'error', exitCode: 1 }); });
  assert.equal(calls, 1); assert.equal(job.status, 'error'); assert.equal(job.counterexample.role, 'generator');
});
test('cancellation stops scheduling further cases', async () => {
  const job = createJob('owner', config()); let calls = 0;
  await runStress(job, async () => { calls++; job.controller.abort(); return result('42'); });
  assert.equal(job.status, 'cancelled'); assert.equal(calls, 2); assert.equal(job.completed, 0);
});
test('provider outage is an error, not an incorrect solution verdict', async () => {
  const job = createJob('owner', config()); await runStress(job, async () => { throw new Error('Provider unavailable'); });
  assert.equal(job.status, 'error'); assert.equal(job.error, 'Provider unavailable'); assert.equal(job.counterexample, null);
});
test('public job responses omit ownership, source configuration, and controller', () => {
  const publicData = publicJob(createJob('owner', config()));
  assert.ok(!('userId' in publicData)); assert.ok(!('config' in publicData)); assert.ok(!('controller' in publicData));
});
test('validation rejects inverted bounds, excessive work, and unsupported languages', () => {
  assert.throws(() => config({ generator: { type: 'array', minSize: 5, maxSize: 1 } }));
  assert.throws(() => config({ iterations: 51 })); assert.throws(() => config({ iterations: NaN }));
  assert.throws(() => config({ generator: { type: 'custom' } }));
  assert.throws(() => runSchema.parse({ language: 'bash', code: 'anything' }));
});
test('malformed provider responses fail closed', () => {
  assert.throws(() => normalizeResult({ output: 'looks successful' }));
  assert.equal(normalizeResult({ output: 'ok', status: 'success', exit_code: 0, time: '0.5', memory: '2048' }).time, 0.5);
});

test('independent cases reproduce the same sequence as a continuous run', async () => {
  const cfg = config(); const inputs = [];
  const runner = async (_program, input) => { inputs.push(input); return result('42'); };
  await runStress(createJob('owner', cfg), runner);
  const continuous = [...inputs]; inputs.length = 0;
  for (let i = 1; i <= cfg.iterations; i++) await runStressCase(cfg, i, runner);
  assert.deepEqual(inputs, continuous);
});
