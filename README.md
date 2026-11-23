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

### Vercel

This repository includes `vercel.json` and the serverless entry point `api/index.js`. Vercel builds the Vite frontend into `dist` and routes `/api/*` to the Express handler. Deploy the repository root, not just the `dist` folder.

1. In **Vercel → Project → Settings → Environment Variables**, add these values from your local `.env` for **Production** (and Preview if you use preview deployments):

   | Name | Required |
   | --- | --- |
   | `SUPABASE_URL` | Yes |
   | `SUPABASE_PUBLISHABLE_KEY` | Yes |
   | `ONLINECOMPILER_API_KEY` | Yes, for code execution |
   | `SUPABASE_SECRET_KEY` | No; reserved for administrative scripts |
   | `SUPABASE_JWKS_URL` | No; current routes verify sessions through Supabase Auth |

   Vercel does not receive your ignored local `.env`. Do not add `VITE_` prefixes to the compiler or Supabase secret keys.

2. Use the **Vite** framework preset, **`npm run build`** as the build command, and **`dist`** as the output directory. These are also declared in `vercel.json`. Use Node.js 22 or newer and keep Fluid compute enabled; the API function has a 120-second maximum duration.
3. Set your Supabase **Authentication → URL Configuration → Site URL** to `https://algowb.vercel.app`, and add `https://algowb.vercel.app` to Redirect URLs alongside any local development URLs. Substitute your actual deployment URL if it changes.
4. Apply `supabase/schema.sql` if you have not already done so. Existing database tables and rows are preserved.
5. Commit and push the deployment changes to the branch connected to Vercel, then redeploy after adding the environment variables.
6. Open `https://algowb.vercel.app/api/health`; it should return `{"status":"ok"}`. `/api/config` should return JSON containing `stressMode: "stepped"`. It exposes the browser-safe Supabase key, never either secret key.

On Vercel, the browser runs stress cases sequentially through authenticated `/api/stress/step` requests. Each request generates and executes **one case** and finishes before the next begins. Configurations and completed progress stay in the browser draft; refreshing resumes the next unfinished case on any server instance. Keep the tab open while testing. Completed reports save to the existing `stress_runs` table with RLS. This avoids relying on background work or shared process memory between function invocations.

If the page reports a missing environment variable, add it in Vercel and redeploy. If `/api/health` returns HTML or 404, check that the deployment contains `api/index.js` and `vercel.json` and that the project root points at this repository. Use Vercel's function logs for server errors; running `npm run dev` locally cannot start the deployed backend.

### A persistent Node server

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

In persistent-server mode, stress jobs live in process memory and stop on server restart; finished jobs remain available for 30 minutes. Vercel uses the per-case browser-driven mode described above. Set `STRESS_MODE=stepped` to exercise that mode locally. Both modes have a 10-minute overall deadline and save reports to Supabase. Execution quotas are per process; deployments requiring strict quotas across multiple instances should use a shared rate-limit store.

The testcase debugger, algorithm visualizer, template vault, and whiteboard are outside this implementation's requested scope.

Provider references: [OnlineCompiler run API](https://onlinecompiler.io/docs/run-code), [compiler identifiers](https://onlinecompiler.io/docs/compilers), [Supabase email signup](https://supabase.com/docs/reference/javascript/auth-signup), [Supabase API key roles](https://supabase.com/docs/guides/getting-started/api-keys), [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js), [Vercel routing configuration](https://vercel.com/docs/project-configuration/vercel-json).
