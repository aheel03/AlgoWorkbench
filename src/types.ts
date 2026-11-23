import type { SupabaseClient, Session } from '@supabase/supabase-js';

export type Language = 'cpp' | 'python' | 'java' | 'javascript' | 'c';
export type Program = { language: Language; code: string };
export type RunResult = { output: string; error: string; status: string; exitCode: number; time: number; memory: number; truncated: boolean };
export type Solution = { id?: string; title: string; language: Language; code: string; input: string; updated_at?: string };
export type SolutionItem = Pick<Solution, 'id' | 'title' | 'language' | 'updated_at'>;
export type Generator = { type: 'array' | 'pairs' | 'custom'; minSize: number; maxSize: number; minValue: number; maxValue: number; program?: Program };
export type StressConfig = { brute: Program; optimized: Program; generator: Generator; iterations: number; seed: number; comparison: 'tokens' | 'exact'; timeLimit: number };
export type StressJob = {
  id: string; status: 'running' | 'passed' | 'mismatch' | 'error' | 'cancelled';
  completed: number; total: number; seed: number; startedAt: number; finishedAt?: number; error: string | null;
  logs: { iteration: number; matches: boolean; bruteTime: number; optimizedTime: number }[];
  counterexample: { iteration: number; input: string; brute?: RunResult; optimized?: RunResult; generator?: RunResult; role?: string } | null;
};
export type HistoryItem = { id: string; result: StressJob; created_at: string };
export type StressStep = { status: 'passed' | 'mismatch' | 'error'; log: StressJob['logs'][number] | null; counterexample: StressJob['counterexample']; error: string | null };
export type AppConfig = { supabaseUrl: string; supabasePublishableKey: string; compilerConfigured: boolean; stressMode?: 'stepped' | 'background'; languages: { id: Language; name: string; compiler: string; extension: string }[] };
export type AppContext = { client: SupabaseClient | null; session: Session | null; config: AppConfig; requireAuth: () => boolean; notify: (message: string) => void; owner: string };
