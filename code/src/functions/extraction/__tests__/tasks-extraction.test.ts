import { createMockEvent, createTestExtractionAdapter } from '@devrev/airsync-sdk';

import { HttpClient, SourceHttpError } from '../../external-system/http-client';
import { normalizeTask } from '../../external-system/data-normalization';
import { initialExtractorState } from '../index';
import { extractTasks } from '../tasks-extraction';

const item = { id: '1', title: 'Example', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' };

function adapter() {
  return createTestExtractionAdapter({
    event: createMockEvent('http://127.0.0.1:1', { payload: { event_context: { run_id: 'run-1' } } }),
    initialState: { ...initialExtractorState, runId: 'run-1', cursor: '3' },
  });
}

afterEach(() => jest.restoreAllMocks());

test('rate limit delays without changing the source cursor', async () => {
  const current = adapter();
  jest.spyOn(HttpClient.prototype, 'getTasks').mockRejectedValue(new SourceHttpError(429, 7));
  await expect(extractTasks(current)).resolves.toEqual({ status: 'delay', delaySeconds: 7 });
  expect(current.state.cursor).toBe('3');
  expect(current.state.completed).toBe(false);
});

test('failed upload does not advance the cursor', async () => {
  const current = adapter();
  jest.spyOn(HttpClient.prototype, 'getTasks').mockResolvedValue({ items: [item], next_cursor: '6' });
  current.initializeRepos([{ itemType: 'tasks', normalize: normalizeTask }]);
  const repo = current.getRepo('tasks');
  if (!repo) throw new Error('Missing test repo');
  jest.spyOn(current, 'initializeRepos').mockImplementation(() => {});
  jest.spyOn(repo, 'upload').mockRejectedValue(new Error('Upload failed'));
  await expect(extractTasks(current)).rejects.toThrow('Upload failed');
  expect(current.state.cursor).toBe('3');
  expect(current.state.completed).toBe(false);
});

test('invalid timestamps and empty titles are rejected', () => {
  expect(() => normalizeTask({ ...item, updated_at: 'bad' })).toThrow('Invalid source task');
  expect(() => normalizeTask({ ...item, title: ' ' })).toThrow('Invalid source task');
});

test('client rejects a repeated cursor and malformed page', async () => {
  const current = adapter();
  jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: [item], next_cursor: '3' })));
  const client = new HttpClient(current.event);
  await expect(client.getTasks('3')).rejects.toThrow('did not advance');
  jest.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({ items: [{ ...item, title: null }], next_cursor: null })));
  await expect(client.getTasks('3')).rejects.toThrow('Invalid source task');
});

test('client accepts numeric and HTTP date retry hints', async () => {
  const current = adapter();
  const request = jest.spyOn(global, 'fetch');
  request.mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': '9' } }));
  await expect(new HttpClient(current.event).getTasks(null)).rejects.toMatchObject({ status: 429, delaySeconds: 9 });
  request.mockResolvedValue(new Response(null, { status: 429, headers: {
    'retry-after': new Date(Date.now() + 60_000).toUTCString(),
  } }));
  try {
    await new HttpClient(current.event).getTasks(null);
    throw new Error('Expected rate limit');
  } catch (error) {
    expect(error).toBeInstanceOf(SourceHttpError);
    expect((error as SourceHttpError).delaySeconds).toBeGreaterThan(55);
  }
});
