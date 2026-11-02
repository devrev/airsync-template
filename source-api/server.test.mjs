import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createTasksServer } from './server.mjs';

test('source API supports authenticated pagination and incremental windows', async t => {
  const server = createTasksServer({ token: 'test-token', clock: () => new Date('2026-02-01T12:00:00Z') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { authorization: 'Bearer test-token' };
  assert.equal((await fetch(`${origin}/tasks?project_id=demo-project`)).status, 401);
  const ids = [];
  let cursor = null;
  let pages = 0;
  do {
    const url = new URL('/tasks', origin);
    url.searchParams.set('project_id', 'demo-project');
    url.searchParams.set('limit', '3');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200);
    const page = await response.json();
    ids.push(...page.items.map(task => task.id));
    cursor = page.next_cursor;
    pages++;
  } while (cursor);
  assert.equal(pages, 4);
  assert.deepEqual(ids, Array.from({ length: 10 }, (_, i) => String(i + 1)));
  const update = await fetch(`${origin}/tasks/1`, {
    method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Updated task' }),
  });
  assert.equal(update.status, 200);
  const incremental = new URL('/tasks', origin);
  incremental.searchParams.set('project_id', 'demo-project');
  incremental.searchParams.set('updated_from', '2026-02-01T00:00:00Z');
  incremental.searchParams.set('updated_to', '2026-02-02T00:00:00Z');
  const result = await (await fetch(incremental, { headers })).json();
  assert.deepEqual(result.items.map(task => task.id), ['1']);
  assert.equal(result.items[0].title, 'Updated task');
  assert.equal(result.next_cursor, null);
  const empty = await (await fetch(`${origin}/tasks?project_id=unknown`, { headers })).json();
  assert.deepEqual(empty, { items: [], next_cursor: null });
  for (const query of ['limit=0', 'cursor=bad', 'updated_from=bad']) {
    assert.equal((await fetch(`${origin}/tasks?project_id=demo-project&${query}`, { headers })).status, 400);
  }
  assert.equal((await fetch(`${origin}/tasks/1`, {
    method: 'PATCH', headers, body: '{',
  })).status, 400);
});
