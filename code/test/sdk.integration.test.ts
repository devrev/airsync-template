import { Worker } from 'node:worker_threads';
import { gzipSync } from 'node:zlib';
import path from 'path';
import { createMockEvent, EventType, MockServer } from '@devrev/airsync-sdk';

import { initialExtractorState } from '../src/functions/extraction';

const bootstrap = `
  const { workerData } = require('node:worker_threads');
  require('ts-node/register/transpile-only');
  require(workerData.workerPath);
`;

type Callback = { event_type: string; event_data: Record<string, unknown> };

jest.setTimeout(15000);

describe('template workers with the real SDK', () => {
  const server = new MockServer(0);

  beforeAll(() => server.start());
  afterAll(() => server.stop());
  beforeEach(() => {
    server.resetRoutes();
    server.setRoute({ method: 'GET', path: '/internal/airdrop.sync-mapper-record.get-by-external-id', status: 404, body: {} });
    seedState({ ...structuredClone(initialExtractorState), snapInVersionId: 'test_snap_in_version_id' });
  });

  function seedState(state: unknown, objects = { todos: { extract: true }, users: { extract: true }, attachments: { extract: true } }) {
    server.setRoute({ method: 'GET', path: '/worker_data_url.get', status: 200,
      body: { state: JSON.stringify(state), objects: JSON.stringify(objects) } });
  }

  async function runWorker(name: string, eventType: EventType) {
    const worker = new Worker(bootstrap, {
      eval: true, stdout: true, stderr: true,
      workerData: {
        event: createMockEvent(server.baseUrl, { payload: { event_type: eventType, event_data: { stats_file: 'stats' } } }),
        initialState: structuredClone(initialExtractorState),
        workerPath: path.join(__dirname, '../src/functions', name.startsWith('load-') ? 'loading' : 'extraction', 'workers', `${name}.ts`),
      },
    });
    const logs: string[] = [];
    worker.on('message', (message) => {
      if (message.subject === 'log') logs.push(message.payload.stringifiedArgs);
    });
    worker.stderr?.on('data', (data: Buffer) => logs.push(data.toString()));
    const deadline = setTimeout(() => void worker.terminate(), 12000);
    try {
      await new Promise<void>((resolve, reject) => {
        worker.once('error', reject);
        worker.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Worker exited ${code}: ${logs.slice(-5).join('\n')}`)));
      });
      const callbacks = server.getCallbackRequests();
      expect(callbacks).toHaveLength(1);
      const updates = server.getRequests('POST', '/worker_data_url.update');
      const state = updates.length ? JSON.parse((updates[updates.length - 1].body as { state: string }).state) : undefined;
      return { callback: callbacks[0].body as Callback, state, logs };
    } finally {
      clearTimeout(deadline);
    }
  }

  it.each([
    ['external-sync-units-extraction', EventType.StartExtractingExternalSyncUnits, 'EXTERNAL_SYNC_UNIT_EXTRACTION_DONE'],
    ['metadata-extraction', EventType.StartExtractingMetadata, 'METADATA_EXTRACTION_DONE'],
  ] as const)('uploads %s and emits one completion', async (name, type, completion) => {
    const result = await runWorker(name, type);
    expect(result.callback.event_type).toBe(completion);
    expect(server.getRequestCount('GET', '/internal/airdrop.artifacts.upload-url')).toBeGreaterThan(0);
    expect(server.getRequestCount('POST', '/file-upload-url')).toBeGreaterThan(0);
  });

  it('extracts all demo entities and persists the v2 state envelope', async () => {
    const result = await runWorker('data-extraction', EventType.StartExtractingData);
    expect(result.callback.event_type).toBe('DATA_EXTRACTION_DONE');
    expect(result.state).toMatchObject({ stateVersion: 2, connectorState: {
      todos: { completed: true }, users: { completed: true }, attachments: { completed: true },
    } });
    expect(server.getRequestCount('GET', '/internal/airdrop.artifacts.upload-url')).toBe(3);
  });

  it('does not upload unselected entities', async () => {
    seedState({ ...structuredClone(initialExtractorState), snapInVersionId: 'test_snap_in_version_id' }, {
      todos: { extract: true }, users: { extract: false }, attachments: { extract: false },
    });
    const result = await runWorker('data-extraction', EventType.StartExtractingData);
    expect(result.callback.event_type).toBe('DATA_EXTRACTION_DONE');
    expect(server.getRequestCount('GET', '/internal/airdrop.artifacts.upload-url')).toBe(1);
  });

  it('does not re-upload immutable attachments that already have artifact mappers', async () => {
    server.setRoute({ method: 'GET', path: '/internal/airdrop.sync-mapper-record.get-by-external-id', status: 200,
      body: { sync_mapper_record: { id: 'mapper-1', targets: ['artifact-1'], status: 'operational' } } });
    const result = await runWorker('data-extraction', EventType.StartExtractingData);
    expect(result.callback.event_type).toBe('DATA_EXTRACTION_DONE');
    expect(server.getRequestCount('GET', '/internal/airdrop.artifacts.upload-url')).toBe(2);
    expect(result.state.connectorState.attachments.completed).toBe(true);
  });

  function serveLoadingBatch(itemType: string, item: unknown) {
    seedState({ ...structuredClone(initialExtractorState), snapInVersionId: 'test_snap_in_version_id',
      fromDevRev: { filesToLoad: [{ id: 'batch', file_name: 'batch.jsonl', itemType, count: 1, lineToProcess: 0, completed: false }] } });
    const downloadPath = '/internal/airdrop.artifacts.download-url';
    server.setRoute({ method: 'GET', path: downloadPath, status: 200,
      body: { get download_url() { return `${server.baseUrl}/${server.getRequestCount('GET', downloadPath) === 1 ? 'stats' : 'batch'}`; } } });
    server.setRoute({ method: 'GET', path: '/stats', status: 200,
      bodyBuffer: Buffer.from(`${JSON.stringify({ id: 'batch', file_name: 'batch.jsonl', item_type: itemType, count: '1' })}\n`) });
    server.setRoute({ method: 'GET', path: '/batch', status: 200, bodyBuffer: gzipSync(`${JSON.stringify(item)}\n`) });
    server.setRoute({ method: 'GET', path: '/internal/airdrop.sync-mapper-record.get-by-target', status: 404, body: {} });
  }

  it('loads a transformed Todo and creates its mapper', async () => {
    serveLoadingBatch('todos', { id: { devrev: 'work-1' }, data: { title: 'SDK integration', body: { type: 'rich_text', content: ['**Markdown**'] } } });
    const result = await runWorker('load-data', EventType.StartLoadingData);
    expect(result.callback.event_type).toBe('DATA_LOADING_DONE');
    const mappers = server.getRequests('POST', '/internal/airdrop.sync-mapper-record.create');
    expect(mappers).toHaveLength(1);
    expect(mappers[0].body).toMatchObject({ external_ids: [expect.stringMatching(/^todo-/)] });
    expect(result.state.sdkState.fromDevRev.filesToLoad[0]).toMatchObject({ completed: true, lineToProcess: 1 });
  });

  it('loads an attachment and creates its mapper', async () => {
    serveLoadingBatch('attachment', { reference_id: 'file-1', parent_id: 'work-1', file_name: 'sample.txt', url: `${server.baseUrl}/file` });
    const result = await runWorker('load-attachments', EventType.StartLoadingAttachments);
    expect(result.callback.event_type).toBe('ATTACHMENT_LOADING_DONE');
    expect(server.getRequestCount('POST', '/internal/airdrop.sync-mapper-record.create')).toBe(1);
  });

  it('updates the mapped external Todo rather than the DevRev ID', async () => {
    serveLoadingBatch('todos', { id: { devrev: 'work-1', external: 'todo-1' }, data: { title: 'Updated SDK Todo', body: 'Updated body' } });
    server.setRoute({ method: 'GET', path: '/internal/airdrop.sync-mapper-record.get-by-target', status: 200,
      body: { sync_mapper_record: { id: 'mapper-1', external_ids: ['todo-1'], targets: ['work-1'] } } });
    const result = await runWorker('load-data', EventType.StartLoadingData);
    expect(result.callback.event_type).toBe('DATA_LOADING_DONE');
    expect(result.callback.event_data.reports).toEqual([expect.objectContaining({ item_type: 'todos', updated: 1 })]);
    expect(server.getRequestCount('POST', '/internal/airdrop.sync-mapper-record.update')).toBe(1);
  });

  it.each([200, 429] as const)('streams attachment bytes or preserves the cursor on HTTP %s', async (status) => {
    seedState({ ...structuredClone(initialExtractorState), snapInVersionId: 'test_snap_in_version_id',
      toDevRev: { attachmentsMetadata: { artifactIds: ['metadata'], lastProcessed: 0 } } });
    server.setRoute({ method: 'GET', path: '/internal/airdrop.artifacts.download-url', status: 200,
      body: { download_url: `${server.baseUrl}/metadata` } });
    server.setRoute({ method: 'GET', path: '/metadata', status: 200,
      bodyBuffer: gzipSync(`${JSON.stringify({ id: 'file-1', url: `${server.baseUrl}/file`, file_name: 'sample.txt', parent_id: 'todo-1' })}\n`) });
    server.setRoute({ method: 'GET', path: '/file', status,
      headers: { 'content-length': '5', 'content-type': 'text/plain', 'retry-after': '3' }, bodyBuffer: Buffer.from('hello') });
    const result = await runWorker('attachments-extraction', EventType.StartExtractingAttachments);
    expect(result.callback.event_type).toBe(status === 200 ? 'ATTACHMENT_EXTRACTION_DONE' : 'ATTACHMENT_EXTRACTION_DELAYED');
    if (status === 200) {
      expect(server.getRequestCount('POST', '/file-upload-url')).toBeGreaterThan(0);
      expect(result.state.sdkState.toDevRev.attachmentsMetadata.artifactIds).toEqual([]);
    } else {
      expect(result.callback.event_data.delay).toBe(3);
      expect(result.state.sdkState.toDevRev.attachmentsMetadata.artifactIds).toEqual(['metadata']);
    }
  });
});
