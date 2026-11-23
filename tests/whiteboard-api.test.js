import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { emptyDocument, makePreset } from '../shared/whiteboard.js';

test('whiteboard CRUD validates diagrams and isolates each account', async t => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
  const owners = { 'session-a': '11111111-1111-4111-8111-111111111111', 'session-b': '22222222-2222-4222-8222-222222222222' };
  const rows = new Map(); const realFetch = globalThis.fetch;
  let missingTable = false;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== 'https://example.supabase.co') return realFetch(input, options);
    const token = new Headers(options.headers).get('authorization')?.replace('Bearer ', '');
    const owner = owners[token];
    if (url.pathname === '/auth/v1/user') return Response.json({ id: owner, aud: 'authenticated', user_metadata: {} });
    assert.equal(url.pathname, '/rest/v1/whiteboards');
    if (missingTable) return Response.json({ code: 'PGRST205', message: 'Table is missing' }, { status: 404 });
    const method = options.method || 'GET';
    const id = url.searchParams.get('id')?.replace('eq.', '');
    if (method === 'POST') {
      const row = JSON.parse(options.body);
      assert.equal(row.user_id, owner, 'the server binds ownership to the authenticated session');
      const saved = { ...row, id: crypto.randomUUID(), updated_at: new Date().toISOString() };
      rows.set(saved.id, saved); return Response.json(saved);
    }
    assert.equal(url.searchParams.get('user_id'), `eq.${owner}`, 'every read, update, and delete includes an owner filter');
    const row = rows.get(id);
    if (method === 'GET') {
      if (id) return Response.json(row?.user_id === owner ? [row] : []);
      return Response.json([...rows.values()].filter(r => r.user_id === owner));
    }
    if (method === 'PATCH') {
      if (row?.user_id !== owner) return Response.json(null);
      const updated = { ...row, ...JSON.parse(options.body) };
      rows.set(id, updated); return Response.json(updated);
    }
    if (method === 'DELETE') {
      if (row?.user_id === owner) rows.delete(id);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected database operation ${method}`);
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const server = createApp({ serverless: true, serveFrontend: false }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (token, route = '', method = 'GET', body) => realFetch(`http://127.0.0.1:${server.address().port}/api/whiteboards${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const document = { ...emptyDocument(), elements: makePreset('tree', { x: 400, y: 250 }) };
  const created = await request('session-a', '', 'POST', { title: 'DFS trace', document, user_id: owners['session-b'] });
  assert.equal(created.status, 201); const saved = await created.json(); assert.equal(saved.user_id, owners['session-a']);
  assert.equal((await (await request('session-a')).json()).length, 1);
  assert.equal((await (await request('session-b')).json()).length, 0);
  assert.equal((await request('session-b', `/${saved.id}`)).status, 404);
  assert.equal((await request('session-b', '', 'POST', { id: saved.id, title: 'Changed', document })).status, 404);
  await request('session-b', `/${saved.id}`, 'DELETE'); assert.ok(rows.has(saved.id));
  const updated = await request('session-a', '', 'POST', { id: saved.id, title: 'DFS recursion', document });
  assert.equal(updated.status, 200); assert.equal((await updated.json()).title, 'DFS recursion');
  const bad = structuredClone(document); bad.elements[0].color = 'url(javascript:alert(1))';
  assert.equal((await request('session-a', '', 'POST', { title: 'Unsafe', document: bad })).status, 400);
  await request('session-a', `/${saved.id}`, 'DELETE'); assert.equal(rows.size, 0);
  missingTable = true;
  const pending = await request('session-a'); assert.equal(pending.status, 503); assert.match((await pending.json()).error, /schema.sql/);
});
