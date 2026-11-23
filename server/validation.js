import { z } from 'zod';

export const LANGUAGES = [
  { id: 'cpp', name: 'C++ 20', compiler: 'g++-15-cpp20', extension: 'cpp' },
  { id: 'python', name: 'Python 3', compiler: 'python-3.14', extension: 'py' },
  { id: 'java', name: 'Java', compiler: 'openjdk-25', extension: 'java' },
  { id: 'javascript', name: 'JavaScript', compiler: 'nodejs-24', extension: 'js' },
  { id: 'c', name: 'C', compiler: 'gcc-15', extension: 'c' },
];
const language = z.enum(['cpp', 'python', 'java', 'javascript', 'c']);
const source = z.string().min(1, 'Write some code first.').max(90000, 'Source code must be under 90,000 characters.');
export const programSchema = z.object({ language, code: source });
export const runSchema = programSchema.extend({ input: z.string().max(64000).default(''), timeLimit: z.number().min(1).max(10).default(5) });
export const generatorSchema = z.object({
  type: z.enum(['array', 'pairs', 'custom']),
  minSize: z.number().int().min(1).max(1000).default(1),
  maxSize: z.number().int().min(1).max(1000).default(10),
  minValue: z.number().int().min(-1000000000).max(1000000000).default(-100),
  maxValue: z.number().int().min(-1000000000).max(1000000000).default(100),
  program: programSchema.optional(),
}).superRefine((g, ctx) => {
  if (g.minSize > g.maxSize) ctx.addIssue({ code: 'custom', message: 'Minimum size must not exceed maximum size.' });
  if (g.minValue > g.maxValue) ctx.addIssue({ code: 'custom', message: 'Minimum value must not exceed maximum value.' });
  if (g.type === 'custom' && !g.program) ctx.addIssue({ code: 'custom', message: 'A custom generator needs source code.' });
});
export const stressSchema = z.object({
  brute: programSchema, optimized: programSchema, generator: generatorSchema,
  iterations: z.number().int().min(1).max(50).default(10),
  seed: z.number().int().min(0).max(4294967295).default(42),
  comparison: z.enum(['tokens', 'exact']).default('tokens'),
  timeLimit: z.number().min(1).max(10).default(3),
});
export const stressStepSchema = z.object({
  config: stressSchema,
  iteration: z.number().int().min(1).max(50),
}).refine(data => data.iteration <= data.config.iterations, 'The case number exceeds the configured test count.');

const executionResultSchema = z.object({
  output: z.string().max(65536), error: z.string().max(65536),
  status: z.enum(['success', 'error']), exitCode: z.number().int(),
  time: z.number().nonnegative(), memory: z.number().nonnegative(), truncated: z.boolean(),
});
const stressResultSchema = z.object({
  id: z.string().uuid(), status: z.enum(['passed', 'mismatch', 'error', 'cancelled']),
  completed: z.number().int().min(0).max(50), total: z.number().int().min(1).max(50),
  seed: z.number().int().min(0).max(4294967295),
  startedAt: z.number().int().nonnegative(), finishedAt: z.number().int().nonnegative(),
  logs: z.array(z.object({ iteration: z.number().int().min(1).max(50), matches: z.boolean(), bruteTime: z.number().nonnegative(), optimizedTime: z.number().nonnegative() })).max(50),
  error: z.string().max(2000).nullable(),
  counterexample: z.object({
    iteration: z.number().int().min(1).max(50), input: z.string().max(65536),
    brute: executionResultSchema.optional(), optimized: executionResultSchema.optional(), generator: executionResultSchema.optional(),
    role: z.enum(['brute', 'optimized', 'generator']).nullable().optional(),
  }).nullable(),
});
export const stressReportSchema = z.object({ config: stressSchema, result: stressResultSchema }).superRefine(({ config, result }, ctx) => {
  if (result.total !== config.iterations || result.seed !== config.seed || result.completed > result.total || result.completed !== result.logs.length || result.finishedAt < result.startedAt) {
    ctx.addIssue({ code: 'custom', message: 'The stress-test result does not match its configuration.' });
  }
  if (result.status === 'passed' && (result.completed !== result.total || result.counterexample || result.logs.some(log => !log.matches))) {
    ctx.addIssue({ code: 'custom', message: 'A passing run must complete every case successfully.' });
  }
});
export const solutionSchema = z.object({
  id: z.string().uuid().optional(), title: z.string().trim().min(1).max(100),
  language, code: source, input: z.string().max(64000).default(''),
});
export const profileSchema = z.object({ username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/, 'Use letters, numbers, and underscores.') });
