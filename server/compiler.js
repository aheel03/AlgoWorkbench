import { LANGUAGES } from './validation.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function normalizeResult(data) {
  if (!data || !['success', 'error'].includes(data.status) || !Number.isInteger(data.exit_code) || typeof data.output !== 'string') {
    throw new HttpError(502, 'The compiler returned an unexpected response. Try again shortly.');
  }
  return {
    output: data.output, error: String(data.error || ''),
    status: data.status, exitCode: data.exit_code,
    time: Number(data.time) || 0, memory: Number(data.memory) || 0,
    truncated: Boolean(data.truncated),
  };
}

export async function execute(program, input = '', timeLimit = 5, signal) {
  if (!process.env.ONLINECOMPILER_API_KEY) throw new HttpError(503, 'The compiler API key has not been configured on the server.');
  const compiler = LANGUAGES.find(l => l.id === program.language)?.compiler;
  if (!compiler) throw new HttpError(400, 'Unsupported language.');
  let response;
  try {
    response = await fetch('https://api.onlinecompiler.io/api/run-code-sync/', {
      method: 'POST',
      headers: { Authorization: process.env.ONLINECOMPILER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ compiler, code: program.code, input, time_limit: timeLimit, memory_limit: 256 }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new HttpError(502, 'The compiler could not be reached or timed out. Please try again.');
  }
  if (!response.ok) {
    if (response.status === 429) throw new HttpError(429, 'The compiler rate limit was reached. Please wait before trying again.');
    if ([401, 403].includes(response.status)) throw new HttpError(502, 'The compiler rejected the server API key. Check your OnlineCompiler dashboard.');
    throw new HttpError(502, `The compiler service returned HTTP ${response.status}. Please try again.`);
  }
  let data;
  try { data = await response.json(); } catch { throw new HttpError(502, 'The compiler returned an unreadable response.'); }
  return normalizeResult(data);
}

export function succeeded(result) {
  return result.status === 'success' && result.exitCode === 0 && !result.truncated;
}
