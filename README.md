# AlgoWorkbench

A competitive programming workspace for the CSE 4113 Internet Programming Lab project, based on `requirements/AlgoWorkBenchFD.pdf`. This implementation covers **FR-01–08** (accounts and online IDE) and **FR-13–19** (stress testing), with saved solutions and stress-test history.

The interface uses a dark, pixel-inspired workbench with green accents, square borders, pixel typography, and a tiny dinosaur. It adapts to desktop and mobile screens.

## Run locally

Requires **Node.js 22.13 or newer** and npm.

```sh
npm install
npm run dev
```

Open **http://localhost:5173**. The frontend runs on port 5173 and proxies `/api` to the Node server on port 3001.

On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`:

```powershell
npm.cmd run dev
```

The supplied credentials are already configured in the local, ignored `.env`. For a fresh clone, copy `.env.example` to `.env` and fill in your credentials. Never commit `.env`.

## One-time Supabase setup

1. Open the SQL Editor for your Supabase project and run **[supabase/schema.sql](supabase/schema.sql)**. This creates `profiles`, `solutions`, and `stress_runs`, along with indexes and row-level security policies. It is safe to run again.
2. In **Authentication → URL Configuration**, set Site URL to `http://localhost:5173` and add `http://localhost:5173` and `http://127.0.0.1:5173` to Redirect URLs. Add your deployed URL before deployment.
3. Email registration is enabled in the supplied project and **email confirmation is required**. New users must follow the confirmation email before signing in. Account creation uses Supabase Auth directly; no custom schema is needed for authentication itself.

The provided publishable/secret API keys do **not** grant SQL migration access. The migration must be applied in the SQL Editor or through a separately authorized database connection. Until it is applied, account creation, sign-in, compilation, and stress testing work, while account profiles, saved solutions, and saved stress history display a setup message.

Passwords and refresh tokens are managed by Supabase Auth. Profiles are created when the user saves their profile. Normal data requests use the user's verified access token and the publishable key, so RLS remains active; the secret key is reserved for server administration and the optional live integration test.

## Features

- **Accounts:** email/password sign-up, confirmation-aware feedback, sign-in/out, persistent sessions, editable unique usernames, and private account data.
- **IDE:** CodeMirror editor with syntax highlighting, autocomplete, indentation, search, undo, code folding, custom stdin, stdout/stderr, execution status, runtime and memory metrics, local drafts, account saves, reopening/deleting saved solutions, and source downloads. `Ctrl+Enter` runs; `Ctrl+S` saves.
- **Languages:** C++20, Python 3, Java, JavaScript, and C. All compilation happens in OnlineCompiler.io's remote sandbox. Programs are never executed on the application server.
- **Stress Lab:** separate languages for reference and optimized solutions; seeded integer-array and pair generators; custom generator programs; whitespace-token or exact comparison; up to 50 test cases; per-program execution limits; live progress; cancellation; first counterexample with actual outputs/errors; input and JSON downloads; saved run history. Results survive browser refresh, and active jobs reconnect while the server retains them.

### Test generator formats

The array generator writes the length, followed by the array on the next line:

```text
5
1 -3 7 0 2
```

The pair generator writes two integers:

```text
7 8
```

A custom generator receives `seed iteration` on stdin (iteration starts at 1) and must print a complete input case to stdout. The initial Python generator demonstrates deterministic random generation. Custom generators also execute remotely. A fixed seed reproduces built-in generator sequences; a custom generator must use its received seed consistently to provide the same guarantee.

Whitespace-token comparison ignores leading/trailing whitespace and differences between whitespace separators. Exact comparison preserves whitespace except that CRLF line endings normalize to LF. Comparisons are text-based; floating-point tolerance is not implemented.

### Try finding a counterexample

In the Stress Lab, choose Python for both solutions and select the integer-pair generator. Use this reference:

```python
a, b = map(int, input().split())
print(a + b)
```

Use `print(a - b)` instead of the final line in the optimized solution. Start the test: the first pair with a nonzero second value produces a counterexample. Replace subtraction with addition to see a passing run.

## Checks

```sh
npm test                 # Unit and API security/validation tests
npm run build           # TypeScript and production bundle
npm run check:services  # Auth settings, schema detection, one live Python run
npx playwright install chromium
npm run test:e2e        # Desktop/mobile, sign-up UX, IDE results, stress recovery
```

Browser tests use mocked provider responses for deterministic account/compilation UI checks. The optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE` environment variable selects an existing Chromium installation. Set `E2E_PRODUCTION=1` after building to test the production server rather than Vite.

```sh
npm run test:live
```

The optional live test uses the supplied server secret to create two temporary, confirmed accounts without sending email. It tests password sign-in, all five real compilers, runtime errors, real stress comparisons, and cross-user job isolation, and deletes its accounts in a `finally` block. If the migration is installed, it also verifies saving and cross-user isolation for a solution. It reports persistence checks as pending when tables are absent. This test consumes a small number of compiler executions.

## Production

```sh
npm run build
npm start
```

The Node server serves the compiled frontend and API together at **http://localhost:3001**. Configure the same server environment variables on your hosting platform, update the Supabase redirect URLs, and put the server behind HTTPS. The server binds to loopback for local development; set `HOST=0.0.0.0` when deploying in a container.

`/api/config` exposes only Supabase's browser-safe URL/publishable key, language metadata, and compiler availability. The compiler API key and Supabase secret are never sent to the browser or included in the frontend bundle.

## Project structure

```text
src/                  React + TypeScript UI and CodeMirror editor
server/app.js         Authenticated HTTP API, quotas, persistence, static serving
server/compiler.js    OnlineCompiler.io adapter and response normalization
server/stress.js      Seeded generators and cancellable comparison jobs
server/validation.js  Shared server input schemas and compiler identifiers
supabase/schema.sql   Database tables, constraints, indexes, and RLS
tests/                Engine/API tests and Playwright browser checks
scripts/              Live service diagnostics and integration test
requirements/         Original academic requirements PDF
```

This is a single-server academic implementation. Execution and polling quotas are held in memory. Active jobs stop on server restart; finished jobs remain on the server for 30 minutes and can be saved to Supabase. Stress runs have a 10-minute overall deadline. Multiple server replicas would require a shared queue, job store, and distributed rate limiting.

The testcase debugger, algorithm visualizer, template vault, and whiteboard are outside this implementation's requested scope.

Provider references: [OnlineCompiler run API](https://onlinecompiler.io/docs/run-code), [compiler identifiers](https://onlinecompiler.io/docs/compilers), [Supabase email signup](https://supabase.com/docs/reference/javascript/auth-signup), [Supabase API key roles](https://supabase.com/docs/guides/getting-started/api-keys).
