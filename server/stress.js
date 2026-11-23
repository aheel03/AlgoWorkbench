import { randomUUID } from 'node:crypto';
import { execute, succeeded } from './compiler.js';

// Mulberry32: the same seed produces the same built-in test sequence on every run.
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function createGenerator(config, seed) {
  const random = seededRandom(seed);
  const integer = (min, max) => min + Math.floor(random() * (max - min + 1));
  return () => {
    if (config.type === 'pairs') return `${integer(config.minValue, config.maxValue)} ${integer(config.minValue, config.maxValue)}\n`;
    const n = integer(config.minSize, config.maxSize);
    return `${n}\n${Array.from({ length: n }, () => integer(config.minValue, config.maxValue)).join(' ')}\n`;
  };
}

export function compareOutputs(expected, actual, mode = 'tokens') {
  const normalize = s => mode === 'exact' ? s.replace(/\r\n/g, '\n') : s.trim().split(/\s+/).filter(Boolean).join(' ');
  return normalize(expected) === normalize(actual);
}

export function createJob(userId, config) {
  return {
    id: randomUUID(), userId, config, status: 'running', completed: 0,
    total: config.iterations, seed: config.seed, startedAt: Date.now(),
    logs: [], counterexample: null, error: null, controller: new AbortController(),
  };
}

export function publicJob(job) {
  const { controller, config, userId, ...publicData } = job;
  return publicData;
}

// One bounded case can execute on any serverless instance without a job store.
export async function runStressCase(config, iteration, runner = execute, signal) {
  signal?.throwIfAborted();
  let input;
  if (config.generator.type === 'custom') {
    const generatorInput = `${config.seed} ${iteration}\n`;
    const generated = await runner(config.generator.program, generatorInput, config.timeLimit, signal);
    if (!succeeded(generated)) return {
      status: 'error', log: null,
      error: 'The custom generator failed. Inspect its output below.',
      counterexample: { iteration, input: generatorInput, role: 'generator', generator: generated },
    };
    input = generated.output;
  } else {
    const generate = createGenerator(config.generator, config.seed);
    // Advancing the seeded generator also reproduces an arbitrary case after refresh.
    for (let i = 0; i < iteration; i++) input = generate();
  }
  const settled = await Promise.allSettled([
    runner(config.brute, input, config.timeLimit, signal),
    runner(config.optimized, input, config.timeLimit, signal),
  ]);
  const failed = settled.find(r => r.status === 'rejected');
  if (failed) throw failed.reason;
  signal?.throwIfAborted();
  const [brute, optimized] = settled.map(r => r.value);
  const valid = succeeded(brute) && succeeded(optimized);
  const matches = valid && compareOutputs(brute.output, optimized.output, config.comparison);
  return {
    status: matches ? 'passed' : valid ? 'mismatch' : 'error',
    log: { iteration, matches, bruteTime: brute.time, optimizedTime: optimized.time },
    error: valid ? null : 'A solution failed, timed out, or produced truncated output.',
    counterexample: matches ? null : { iteration, input, brute, optimized, role: !succeeded(brute) ? 'brute' : !succeeded(optimized) ? 'optimized' : null },
  };
}

export async function runStress(job, runner = execute) {
  const { config, controller } = job;
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60 * 1000)]);
  try {
    for (let i = 1; i <= config.iterations; i++) {
      signal.throwIfAborted();
      const result = await runStressCase(config, i, runner, signal);
      if (result.log) { job.completed = i; job.logs.push(result.log); }
      if (result.status !== 'passed') {
        job.status = result.status; job.error = result.error; job.counterexample = result.counterexample;
        break;
      }
    }
    if (job.status === 'running') job.status = 'passed';
  } catch (error) {
    job.status = controller.signal.aborted ? 'cancelled' : 'error';
    job.error = controller.signal.aborted ? null : signal.aborted ? 'The stress test exceeded its 10-minute limit.' : error.message;
  } finally { job.finishedAt = Date.now(); }
}
