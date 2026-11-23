import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { LANGUAGES, runSchema, stressSchema, solutionSchema, profileSchema } from './validation.js';
import { execute, HttpError } from './compiler.js';
import { createJob, publicJob, runStress } from './stress.js';

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const jobs = new Map();
const activeRuns = new Map();
const client = token => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) throw new HttpError(503, 'Supabase is not configured. Add the server environment variables.');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  });
};
const dbError = error => {
  if (['42P01', 'PGRST205', '42703'].includes(error.code)) throw new HttpError(503, 'Database setup is pending. Run supabase/schema.sql in the Supabase SQL Editor.');
  if (error.code === '23505') throw new HttpError(409, 'That username is already taken.');
  throw new HttpError(502, 'Your data could not be saved or loaded. Please try again.');
};
const auth = asyncRoute(async (req, res, next) => {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new HttpError(401, 'Sign in to run code and save your work.');
  const db = client(token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Your session has expired. Please sign in again.');
  req.user = data.user; req.db = db; next();
});

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: {
    directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], connectSrc: ["'self'", process.env.SUPABASE_URL || 'https://*.supabase.co'], imgSrc: ["'self'", 'data:'] },
  } }));
  app.use(express.json({ limit: '512kb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/config', (_req, res) => res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
    compilerConfigured: Boolean(process.env.ONLINECOMPILER_API_KEY), languages: LANGUAGES,
  }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: 150, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Please wait a minute.' } }));
  app.use('/api', auth);
  const runLimiter = rateLimit({ windowMs: 60000, limit: 20, keyGenerator: req => req.user.id, message: { error: 'You can run code 20 times a minute. Please wait.' } });
  app.post('/api/run', runLimiter, asyncRoute(async (req, res) => {
    const data = runSchema.parse(req.body);
    const userId = req.user.id;
    if ((activeRuns.get(userId) || 0) >= 2) throw new HttpError(429, 'Two programs are already running. Wait for one to finish.');
    if ([...activeRuns.values()].reduce((a, b) => a + b, 0) >= 8) throw new HttpError(429, 'The compiler queue is full. Try again shortly.');
    activeRuns.set(userId, (activeRuns.get(userId) || 0) + 1);
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', onClose);
    try { res.json(await execute(data, data.input, data.timeLimit, controller.signal)); }
    finally { res.off('close', onClose); activeRuns.set(userId, Math.max(0, (activeRuns.get(userId) || 1) - 1)); if (!activeRuns.get(userId)) activeRuns.delete(userId); }
  }));
  app.post('/api/stress', rateLimit({ windowMs: 60000, limit: 3, keyGenerator: req => req.user.id, message: { error: 'Please wait a minute before starting another stress test.' } }), asyncRoute(async (req, res) => {
    const config = stressSchema.parse(req.body);
    for (const [id, job] of jobs) if (job.finishedAt && Date.now() - job.finishedAt > 30 * 60 * 1000) jobs.delete(id);
    if ([...jobs.values()].some(j => j.userId === req.user.id && j.status === 'running')) throw new HttpError(409, 'You already have a stress test running.');
    if ([...jobs.values()].filter(j => j.status === 'running').length >= 3) throw new HttpError(429, 'The stress test queue is full. Try again shortly.');
    const job = createJob(req.user.id, config); jobs.set(job.id, job);
    res.status(202).json(publicJob(job));
    void runStress(job);
  }));
  const ownedJob = req => {
    const job = jobs.get(req.params.id);
    if (!job || job.userId !== req.user.id) throw new HttpError(404, 'Stress test not found. It may have expired or the server restarted.');
    return job;
  };
  app.get('/api/stress/:id', (req, res, next) => { try { res.json(publicJob(ownedJob(req))); } catch (e) { next(e); } });
  app.delete('/api/stress/:id', (req, res, next) => {
    try { const job = ownedJob(req); if (job.status === 'running') { job.controller.abort(); job.status = 'cancelled'; job.finishedAt = Date.now(); } res.json(publicJob(job)); } catch (e) { next(e); }
  });
  app.get('/api/profile', asyncRoute(async (req, res) => {
    const { data, error } = await req.db.from('profiles').select('*').eq('id', req.user.id).maybeSingle();
    if (error) dbError(error);
    res.json(data);
  }));
  app.patch('/api/profile', asyncRoute(async (req, res) => {
    const fields = profileSchema.parse(req.body);
    const { data, error } = await req.db.from('profiles').upsert({ id: req.user.id, ...fields }).select().single();
    if (error) dbError(error); res.json(data);
  }));
  app.get('/api/solutions', asyncRoute(async (req, res) => {
    const { data, error } = await req.db.from('solutions').select('id,title,language,updated_at').eq('user_id', req.user.id).order('updated_at', { ascending: false }).limit(100);
    if (error) dbError(error); res.json(data);
  }));
  app.get('/api/solutions/:id', asyncRoute(async (req, res) => {
    const { data, error } = await req.db.from('solutions').select('*').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
    if (error) dbError(error); if (!data) throw new HttpError(404, 'Solution not found.'); res.json(data);
  }));
  app.post('/api/solutions', asyncRoute(async (req, res) => {
    const { id, ...fields } = solutionSchema.parse(req.body);
    const row = { ...fields, user_id: req.user.id };
    const query = id ? req.db.from('solutions').update(row).eq('id', id).eq('user_id', req.user.id) : req.db.from('solutions').insert(row);
    const { data, error } = await query.select().maybeSingle();
    if (error) dbError(error); if (!data) throw new HttpError(404, 'Solution not found.'); res.status(id ? 200 : 201).json(data);
  }));
  app.delete('/api/solutions/:id', asyncRoute(async (req, res) => {
    const { error } = await req.db.from('solutions').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) dbError(error); res.status(204).end();
  }));
  app.post('/api/stress/:id/save', asyncRoute(async (req, res) => {
    const job = ownedJob(req);
    if (job.status === 'running') throw new HttpError(409, 'Wait for this test to finish before saving it.');
    const { data, error } = await req.db.from('stress_runs').upsert({ id: job.id, user_id: req.user.id, config: job.config, result: publicJob(job) }).select().single();
    if (error) dbError(error); res.json(data);
  }));
  app.get('/api/history', asyncRoute(async (req, res) => {
    const { data, error } = await req.db.from('stress_runs').select('id,result,created_at').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(30);
    if (error) dbError(error); res.json(data);
  }));
  app.get('/api/history/:id', asyncRoute(async (req, res) => {
    const { data, error } = await req.db.from('stress_runs').select('*').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
    if (error) dbError(error); if (!data) throw new HttpError(404, 'Saved test not found.'); res.json(data);
  }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof ZodError) return res.status(400).json({ error: error.issues.map(i => i.message).join(' ') });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Invalid JSON request.' });
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Something went wrong. Please try again.' });
  });
  return app;
}
