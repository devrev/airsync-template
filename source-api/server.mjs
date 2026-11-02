import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function createTasksServer({ token, clock = () => new Date() }) {
  if (!token) throw new Error('EXAMPLE_API_TOKEN is required');
  const tasks = Array.from({ length: 10 }, (_, index) => ({
    id: String(index + 1),
    project_id: 'demo-project',
    title: `Example task ${index + 1}`,
    created_at: '2026-01-01T09:00:00.000Z',
    updated_at: '2026-01-01T09:00:00.000Z',
  }));
  return createServer(async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    try {
      if (request.headers.authorization !== `Bearer ${token}`) {
        send(401, { error: 'Unauthorized' });
        return;
      }
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/projects') {
        send(200, [{
          id: 'demo-project', name: 'Demo Project', description: 'Ten example tasks',
          item_count: tasks.length,
        }]);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/tasks') {
        const project = url.searchParams.get('project_id');
        const limit = Number(url.searchParams.get('limit') ?? 3);
        const cursor = url.searchParams.get('cursor') ?? '0';
        const offset = Number(cursor);
        const from = url.searchParams.get('updated_from');
        const to = url.searchParams.get('updated_to');
        if (!project || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
            !/^\d+$/.test(cursor) || !Number.isSafeInteger(offset) ||
            (from !== null && !Number.isFinite(Date.parse(from))) ||
            (to !== null && !Number.isFinite(Date.parse(to))) ||
            (from !== null && to !== null && Date.parse(from) > Date.parse(to))) {
          send(400, { error: 'Invalid project, pagination, or time window' });
          return;
        }
        const filtered = tasks.filter(task => task.project_id === project &&
          (from === null || Date.parse(task.updated_at) >= Date.parse(from)) &&
          (to === null || Date.parse(task.updated_at) <= Date.parse(to)));
        const items = filtered.slice(offset, offset + limit);
        const nextOffset = offset + items.length;
        send(200, { items, next_cursor: nextOffset < filtered.length ? String(nextOffset) : null });
        return;
      }
      const match = /^\/tasks\/(\d+)$/.exec(url.pathname);
      if (request.method === 'PATCH' && match) {
        const task = tasks.find(task => task.id === match[1]);
        if (!task) {
          send(404, { error: 'Task not found' });
          return;
        }
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (Buffer.byteLength(body) > 4096) {
            send(413, { error: 'Request too large' });
            return;
          }
        }
        let payload;
        try { payload = JSON.parse(body); } catch {
          send(400, { error: 'Invalid JSON' });
          return;
        }
        if (!payload || typeof payload.title !== 'string' || !payload.title.trim()) {
          send(400, { error: 'A nonempty title is required' });
          return;
        }
        task.title = payload.title.trim();
        task.updated_at = clock().toISOString();
        send(200, task);
        return;
      }
      send(404, { error: 'Not found' });
    } catch {
      if (!response.headersSent) send(500, { error: 'Source API failure' });
      else response.end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createTasksServer({ token: process.env.EXAMPLE_API_TOKEN });
  server.listen(Number(process.env.PORT ?? 3100), process.env.HOST ?? '127.0.0.1', () => {
    console.log(`Tasks API: http://127.0.0.1:${server.address().port}`);
  });
}
