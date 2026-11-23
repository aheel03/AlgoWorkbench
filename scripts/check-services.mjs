import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { execute } from '../server/compiler.js';

// Read-only checks, except for one isolated compiler execution. Never log credentials.
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) { console.error('Supabase environment variables are missing.'); process.exit(1); }
const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const checks = await Promise.allSettled([
  (async () => {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(15000) });
    console.log(`Supabase Auth: HTTP ${response.status}`);
    if (!response.ok) throw new Error('Supabase rejected the supplied URL or publishable key.');
    const settings = await response.json();
    console.log(`Email registration: ${settings.disable_signup ? 'disabled in project settings' : 'enabled'}; email verification: ${settings.mailer_autoconfirm ? 'not required' : 'required'}`);
  })(),
  (async () => {
    const { error } = await db.from('profiles').select('id').limit(0);
    if (error && ['PGRST205', '42P01'].includes(error.code)) console.log('Database schema: pending; run supabase/schema.sql in the Supabase SQL Editor.');
    else if (error?.code === '42501') console.log('Database schema: present; anonymous access correctly denied.');
    else if (error) throw new Error(`Database check failed (${error.code || 'connection error'}).`);
    else console.log('Database schema: profiles table is available.');
  })(),
  (async () => {
    const result = await execute({ language: 'python', code: 'a, b = map(int, input().split())\nprint(a + b)' }, '2 3\n');
    if (result.status !== 'success' || result.output.trim() !== '5') throw new Error('Compiler returned an unexpected result.');
    console.log('OnlineCompiler: live Python execution passed (2 + 3 = 5).');
  })(),
]);
let failed = false;
for (const check of checks) if (check.status === 'rejected') { failed = true; console.error(check.reason.message); }
if (failed) process.exitCode = 1;
