import type { AppContext, Language, Solution, StressConfig } from './types';
import { useEffect, useState } from 'react';

export const languageNames: Record<Language, string> = { cpp: 'C++ 20', python: 'Python 3', java: 'Java', javascript: 'JavaScript', c: 'C' };
export const extensions: Record<Language, string> = { cpp: 'cpp', python: 'py', java: 'java', javascript: 'js', c: 'c' };
export const starters: Record<Language, string> = {
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    // A small start. A world of possibilities.\n    int n;\n    cin >> n;\n    long long sum = 0;\n    for (int i = 0; i < n; i++) {\n        int x;\n        cin >> x;\n        sum += x;\n    }\n\n    cout << sum << "\\n";\n    return 0;\n}\n',
  python: '# A small start. A world of possibilities.\nimport sys\n\ndata = list(map(int, sys.stdin.read().split()))\nn = data[0]\nprint(sum(data[1:n + 1]))\n',
  javascript: "// A small start. A world of possibilities.\nconst fs = require('fs');\nconst data = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconst n = data[0];\nconst sum = data.slice(1, n + 1).reduce((a, b) => a + b, 0);\nconsole.log(sum);\n",
  java: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        int n = in.nextInt();\n        long sum = 0;\n        for (int i = 0; i < n; i++) {\n            sum += in.nextInt();\n        }\n        System.out.println(sum);\n    }\n}\n',
  c: '#include <stdio.h>\n\nint main(void) {\n    int n, x;\n    long long sum = 0;\n    scanf("%d", &n);\n    for (int i = 0; i < n; i++) {\n        scanf("%d", &x);\n        sum += x;\n    }\n    printf("%lld\\n", sum);\n    return 0;\n}\n',
};
export const initialSolution: Solution = { title: 'sum_of_array', language: 'cpp', code: starters.cpp, input: '5\n1 2 3 4 5\n' };
export const initialStress: StressConfig = {
  brute: { language: 'cpp', code: starters.cpp }, optimized: { language: 'cpp', code: starters.cpp },
  generator: { type: 'array', minSize: 1, maxSize: 10, minValue: -100, maxValue: 100, program: { language: 'python', code: 'import random\nimport sys\n\nseed, iteration = map(int, sys.stdin.read().split())\nrng = random.Random(seed + iteration)\nn = rng.randint(1, 10)\nprint(n)\nprint(*[rng.randint(-100, 100) for _ in range(n)])\n' } },
  iterations: 10, seed: 42, comparison: 'tokens', timeLimit: 3,
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(ctx: AppContext, path: string, options: RequestInit = {}): Promise<T> {
  const { data } = ctx.client ? await ctx.client.auth.getSession() : { data: { session: null } };
  const response = await fetch(`/api${path}`, {
    ...options, headers: { 'Content-Type': 'application/json', ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}), ...options.headers },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({ error: 'The server returned an unreadable response.' }));
  if (!response.ok) throw new ApiError(response.status, body.error || 'The request failed. Please try again.');
  return body as T;
}

export function useDraft<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const saved = localStorage.getItem(key); return saved ? { ...initial, ...JSON.parse(saved) } : initial; } catch { return initial; }
  });
  useEffect(() => {
    const timer = setTimeout(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Editing still works when browser storage is full. */ } }, 400);
    return () => clearTimeout(timer);
  }, [key, value]);
  return [value, setValue];
}

export function download(name: string, content: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const errorMessage = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Please try again.';
