const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { gunzipSync } = require('node:zlib');
const { createMockEvent, EventType } = require('@devrev/airsync-sdk');
const { functionFactory } = require('../dist/function-factory');

async function startPlatform() {
  const callbacks = [];
  const artifacts = [];
  let state = {};
  let scope = {};
  let origin;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks);
      const send = body => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'GET' && url.pathname === '/worker_data_url.get') {
        send({ state: JSON.stringify(state), objects: JSON.stringify(scope) });
      } else if (req.method === 'GET' && url.pathname === '/internal/snap-ins.get') {
        send({ snap_in: { imports: [{ name: 'test_import_slug' }], snap_in_version: { slug: 'test_snap_in_slug' } } });
      } else if (req.method === 'POST' && url.pathname === '/worker_data_url.update') {
        state = JSON.parse(JSON.parse(raw.toString()).state);
        send({ success: true });
      } else if (req.method === 'GET' && url.pathname === '/internal/airdrop.artifacts.upload-url') {
        send({ upload_url: `${origin}/upload?name=${encodeURIComponent(url.searchParams.get('file_name'))}`,
          artifact_id: `artifact-${artifacts.length}`, form_data: {} });
      } else if (req.method === 'POST' && url.pathname === '/upload') {
        const boundary = req.headers['content-type'].split('boundary=')[1];
        const start = raw.indexOf('\r\n\r\n') + 4;
        const end = raw.lastIndexOf(`\r\n--${boundary}`);
        const lines = gunzipSync(raw.subarray(start, end)).toString().trim();
        artifacts.push({ name: url.searchParams.get('name'), items: lines ? lines.split('\n').map(JSON.parse) : [] });
        send({ success: true });
      } else if (req.method === 'POST' && url.pathname === '/callback_url') {
        callbacks.push(JSON.parse(raw.toString()));
        send({ success: true });
      } else {
        send({ success: true });
      }
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, callbacks, artifacts,
    reset: () => { state = {}; scope = {}; },
    setScope: value => { scope = value; },
    get state() { return state; },
  };
}

test('complete import lifecycle using actual SDK workers and HTTP artifacts', { timeout: 60000 }, async t => {
  const { createTasksServer } = await import('../../source-api/server.mjs');
  const source = createTasksServer({ token: 'integration-token', clock: () => new Date('2026-02-01T12:00:00Z') });
  source.listen(0, '127.0.0.1');
  await once(source, 'listening');
  t.after(() => new Promise(resolve => source.close(resolve)));
  const sourceOrigin = `http://127.0.0.1:${source.address().port}`;
  const platform = await startPlatform();
  t.after(() => new Promise(resolve => platform.server.close(resolve)));
  const previousOrigin = process.env.EXAMPLE_API_ORIGIN;
  process.env.EXAMPLE_API_ORIGIN = sourceOrigin;
  t.after(() => {
    if (previousOrigin === undefined) delete process.env.EXAMPLE_API_ORIGIN;
    else process.env.EXAMPLE_API_ORIGIN = previousOrigin;
  });
  const invoke = async (eventType, context = {}) => {
    const before = platform.callbacks.length;
    await functionFactory.extraction([createMockEvent(platform.origin, {
      payload: {
        event_type: eventType,
        connection_data: { key: 'integration-token' },
        event_context: { external_sync_unit_id: 'demo-project', run_id: 'run-1', ...context },
      },
    })]);
    assert.equal(platform.callbacks.length, before + 1, 'one callback per invocation');
    return platform.callbacks.at(-1);
  };

  const discovery = await invoke(EventType.StartExtractingExternalSyncUnits);
  assert.equal(discovery.event_type, 'EXTERNAL_SYNC_UNIT_EXTRACTION_DONE');
  assert.deepEqual(platform.artifacts.at(-1).items, [{
    id: 'demo-project', name: 'Demo Project', description: 'Ten example tasks', item_count: 10, item_type: 'tasks',
  }]);

  assert.equal((await invoke(EventType.StartExtractingMetadata)).event_type, 'METADATA_EXTRACTION_DONE');
  const metadata = platform.artifacts.at(-1).items[0];
  assert.deepEqual(Object.keys(metadata.record_types), ['tasks']);
  assert.equal(metadata.record_types.tasks.is_loadable, false);

  const statuses = [];
  for (let index = 0; index < 4; index++) {
    const callback = await invoke(index === 0 ? EventType.StartExtractingData : EventType.ContinueExtractingData);
    statuses.push(callback.event_type);
  }
  assert.deepEqual(statuses, ['DATA_EXTRACTION_PROGRESS', 'DATA_EXTRACTION_PROGRESS', 'DATA_EXTRACTION_PROGRESS', 'DATA_EXTRACTION_DONE']);
  const tasks = platform.artifacts.filter(file => file.name === 'tasks.jsonl.gz').flatMap(file => file.items);
  assert.equal(tasks.length, 10);
  assert.equal(new Set(tasks.map(task => task.id)).size, 10);
  assert.equal(tasks[0].data.title, 'Example task 1');
  assert.equal(platform.state.connectorState.completed, true);

  await fetch(`${sourceOrigin}/tasks/1`, {
    method: 'PATCH', headers: { authorization: 'Bearer integration-token' },
    body: JSON.stringify({ title: 'Edited for incremental sync' }),
  });
  const beforeIncremental = platform.artifacts.length;
  const incremental = await invoke(EventType.StartExtractingData, {
    run_id: 'run-2', extract_from: '2026-02-01T00:00:00Z', extract_to: '2026-02-02T00:00:00Z',
  });
  assert.equal(incremental.event_type, 'DATA_EXTRACTION_DONE');
  const changed = platform.artifacts.slice(beforeIncremental).flatMap(file => file.items);
  assert.deepEqual(changed.map(task => task.id), ['1']);
  assert.equal(changed[0].data.title, 'Edited for incremental sync');

  platform.setScope({ tasks: { extract: false } });
  const beforeExcluded = platform.artifacts.length;
  assert.equal((await invoke(EventType.StartExtractingData, { run_id: 'run-3' })).event_type, 'DATA_EXTRACTION_DONE');
  assert.equal(platform.artifacts.length, beforeExcluded);
  assert.equal((await invoke(EventType.StartExtractingAttachments)).event_type, 'ATTACHMENT_EXTRACTION_DONE');
});
