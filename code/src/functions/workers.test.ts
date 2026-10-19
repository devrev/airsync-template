import axios, { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';

import { processExtractionTask, processLoadingTask } from '@devrev/airsync-sdk';
import type {
  AirSyncEvent,
  ExternalSystemAttachment,
  ExternalSystemAttachmentStreamingFunction,
  ExternalSystemItem,
  ExternalSystemItemLoadingParams,
  ExternalSystemLoadingFunction,
  ExtractionAdapter,
  ItemTypesToLoadParams,
  LoadingAdapter,
  NormalizedAttachment,
  ProcessTaskInterface,
  RepoInterface,
  TaskResult,
} from '@devrev/airsync-sdk';

import { initialExtractorState } from './extraction';
import type { ExtractorState } from './extraction';
import type { LoaderState } from './loading';
import { INVALID_CHECKPOINT_MESSAGE, MAX_PAGES_PER_INVOCATION } from './external-system/guards';
import { HttpClient } from './external-system/http-client';
import type { ExternalTodo } from './external-system/types';

import './extraction/workers/data-extraction';
import './extraction/workers/external-sync-units-extraction';
import './extraction/workers/attachments-extraction';
import './extraction/workers/metadata-extraction';
import './loading/workers/load-data';
import './loading/workers/load-attachments';

jest.mock('@devrev/airsync-sdk', () => ({
  ...jest.requireActual('@devrev/airsync-sdk'),
  processExtractionTask: jest.fn(),
  processLoadingTask: jest.fn(),
}));

type ExtractionTask = ProcessTaskInterface<ExtractionAdapter<ExtractorState>>['task'];
type LoadingTask = ProcessTaskInterface<LoadingAdapter<LoaderState>>['task'];

// Registration order follows the import order above.
const extractionTasks = jest
  .mocked(processExtractionTask)
  .mock.calls.map(([config]) => config.task as unknown as ExtractionTask);
const loadingTasks = jest.mocked(processLoadingTask).mock.calls.map(([config]) => config.task as unknown as LoadingTask);

if (extractionTasks.length !== 4 || loadingTasks.length !== 2) {
  throw new Error(
    `Expected 4 extraction and 2 loading registrations, found ${extractionTasks.length} and ${loadingTasks.length}`,
  );
}

const [dataExtractionTask, externalSyncUnitsTask, attachmentsExtractionTask, metadataExtractionTask] = extractionTasks;
const [loadDataTask, loadAttachmentsTask] = loadingTasks;

afterEach(() => {
  jest.restoreAllMocks();
});

const RUN_ID = 'run-1';

const makeEvent = (key = 'test-token'): AirSyncEvent =>
  ({ payload: { connection_data: { key }, event_context: { run_id: RUN_ID } } }) as unknown as AirSyncEvent;

const freshExtractorState = (): ExtractorState => structuredClone(initialExtractorState);

type RepoDouble = { push: jest.Mock<Promise<void>, [object[]]> };

type ExtractionDouble = {
  event: AirSyncEvent;
  state: ExtractorState;
  isTimeout: boolean;
  repos: Map<string, RepoDouble>;
  initializeRepos: jest.Mock<void, [RepoInterface[]]>;
  getRepo: (itemType: string) => RepoDouble | undefined;
  shouldExtract: jest.Mock<boolean, [string]>;
  streamAttachments: jest.Mock<Promise<TaskResult>, [{ stream: ExternalSystemAttachmentStreamingFunction }]>;
};

const makeExtractionDouble = (overrides: Partial<Omit<ExtractionDouble, 'repos'>> = {}): ExtractionDouble => {
  const repos = new Map<string, RepoDouble>();
  return {
    event: makeEvent(),
    state: freshExtractorState(),
    isTimeout: false,
    repos,
    initializeRepos: jest.fn((list: RepoInterface[]) => {
      list.forEach(({ itemType }) => repos.set(itemType, { push: jest.fn().mockResolvedValue(undefined) }));
    }),
    getRepo: (itemType: string) => repos.get(itemType),
    shouldExtract: jest.fn().mockReturnValue(true),
    streamAttachments: jest.fn().mockResolvedValue({ status: 'success' }),
    ...overrides,
  };
};

const runExtraction = (task: ExtractionTask, double: ExtractionDouble): Promise<TaskResult> =>
  task({ adapter: double as unknown as ExtractionAdapter<ExtractorState> });

const pushedBatches = (double: ExtractionDouble, itemType: string): object[][] =>
  double.repos.get(itemType)?.push.mock.calls.map(([items]) => items) ?? [];

const httpError = (status: number, headers: Record<string, string> = {}, data: unknown = {}): AxiosError =>
  new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, undefined, {
    status,
    statusText: '',
    headers,
    data,
    config: { headers: new AxiosHeaders() },
  } as AxiosResponse);

const todo: ExternalTodo = {
  id: 'todo-x',
  created_date: '2024-01-01T00:00:00Z',
  modified_date: '2024-01-01T00:00:00Z',
  title: 'Paged todo',
  body: 'Body',
  creator: 'user-1',
  owner: 'user-1',
};

describe('data-extraction worker', () => {
  it('extracts every page of every item type and returns success', async () => {
    const double = makeExtractionDouble();

    await expect(runExtraction(dataExtractionTask, double)).resolves.toEqual({ status: 'success' });

    expect(pushedBatches(double, 'todos').map((batch) => batch.length)).toEqual([5, 5, 5]);
    expect(pushedBatches(double, 'users').map((batch) => batch.length)).toEqual([5, 5]);
    expect(pushedBatches(double, 'attachments').map((batch) => batch.length)).toEqual([2]);
    expect(double.state).toEqual({
      runId: RUN_ID,
      todos: { completed: true, nextPage: 3 },
      users: { completed: true, nextPage: 2 },
      attachments: { completed: true, nextPage: 1 },
    });
  });

  it('returns progress once the page budget is spent, then resumes from the saved cursor', async () => {
    const getTodosPage = jest
      .spyOn(HttpClient.prototype, 'getTodosPage')
      .mockImplementation(async (page) => ({ items: [todo], hasMore: page < MAX_PAGES_PER_INVOCATION + 1 }));
    const first = makeExtractionDouble();

    await expect(runExtraction(dataExtractionTask, first)).resolves.toEqual({ status: 'progress' });
    expect(getTodosPage.mock.calls.map(([page]) => page)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(first.state.todos).toEqual({ completed: false, nextPage: MAX_PAGES_PER_INVOCATION });
    expect(first.repos.get('users')?.push).not.toHaveBeenCalled();

    getTodosPage.mockClear();
    const second = makeExtractionDouble({ state: structuredClone(first.state) });

    await expect(runExtraction(dataExtractionTask, second)).resolves.toEqual({ status: 'success' });
    expect(getTodosPage.mock.calls.map(([page]) => page)).toEqual([10, 11]);
    expect(second.state.todos).toEqual({ completed: true, nextPage: 12 });
    expect(second.state.users.completed).toBe(true);
  });

  it('returns progress on timeout without advancing past the last pushed page', async () => {
    const double = makeExtractionDouble();
    const getTodosPage = jest.spyOn(HttpClient.prototype, 'getTodosPage').mockImplementation(async () => {
      double.isTimeout = true;
      return { items: [todo], hasMore: true };
    });

    await expect(runExtraction(dataExtractionTask, double)).resolves.toEqual({ status: 'progress' });
    expect(getTodosPage).toHaveBeenCalledTimes(1);
    expect(pushedBatches(double, 'todos')).toEqual([[todo]]);
    expect(double.state.todos).toEqual({ completed: false, nextPage: 1 });
  });

  it('returns progress without fetching when the timeout has already fired', async () => {
    const getTodosPage = jest.spyOn(HttpClient.prototype, 'getTodosPage');
    const double = makeExtractionDouble({ isTimeout: true });

    await expect(runExtraction(dataExtractionTask, double)).resolves.toEqual({ status: 'progress' });
    expect(getTodosPage).not.toHaveBeenCalled();
    expect(double.state.todos).toEqual({ completed: false, nextPage: 0 });
  });

  it('marks out-of-scope item types complete without fetching them', async () => {
    const getUsersPage = jest.spyOn(HttpClient.prototype, 'getUsersPage');
    const getAttachmentsPage = jest.spyOn(HttpClient.prototype, 'getAttachmentsPage');
    const double = makeExtractionDouble({
      shouldExtract: jest.fn((itemType: string) => itemType === 'todos'),
    });

    await expect(runExtraction(dataExtractionTask, double)).resolves.toEqual({ status: 'success' });
    expect(getUsersPage).not.toHaveBeenCalled();
    expect(getAttachmentsPage).not.toHaveBeenCalled();
    expect(double.state.users.completed).toBe(true);
    expect(double.state.attachments.completed).toBe(true);
  });

  it('resumes progress of the same run, including buckets without a cursor', async () => {
    const getTodosPage = jest.spyOn(HttpClient.prototype, 'getTodosPage');
    const double = makeExtractionDouble({
      state: { runId: RUN_ID, todos: { completed: true }, users: { completed: false }, attachments: { completed: false } },
    });

    await expect(runExtraction(dataExtractionTask, double)).resolves.toEqual({ status: 'success' });
    expect(getTodosPage).not.toHaveBeenCalled();
    expect(pushedBatches(double, 'users').map((batch) => batch.length)).toEqual([5, 5]);
  });

  it('starts over when a new run begins, keeping keys it does not own', async () => {
    const finished = { completed: true, nextPage: 3 };
    const double = makeExtractionDouble({
      state: {
        runId: 'previous-run',
        todos: finished,
        users: finished,
        attachments: finished,
        lastModified: '2026-01-01',
      } as ExtractorState,
    });

    await expect(runExtraction(dataExtractionTask, double)).resolves.toEqual({ status: 'success' });
    expect(pushedBatches(double, 'todos').map((batch) => batch.length)).toEqual([5, 5, 5]);
    expect(double.state).toMatchObject({ runId: RUN_ID, lastModified: '2026-01-01' });
  });

  it('fails instead of skipping an item type whose repo is missing', async () => {
    const double = makeExtractionDouble({ initializeRepos: jest.fn() });

    await expect(runExtraction(dataExtractionTask, double)).rejects.toThrow('No repo initialized for item type todos');
    expect(double.state.todos).toEqual({ completed: false, nextPage: 0 });
  });

  it('returns a delay honoring Retry-After when rate limited, keeping the cursor', async () => {
    jest.spyOn(HttpClient.prototype, 'getTodosPage').mockRejectedValue(httpError(429, { 'retry-after': '9' }));
    const double = makeExtractionDouble();

    await expect(runExtraction(dataExtractionTask, double)).resolves.toEqual({ status: 'delay', delaySeconds: 9 });
    expect(double.state.todos).toEqual({ completed: false, nextPage: 0 });
  });

  it('rethrows a 429 without Retry-After instead of delaying forever', async () => {
    jest.spyOn(HttpClient.prototype, 'getTodosPage').mockRejectedValue(httpError(429));

    await expect(runExtraction(dataExtractionTask, makeExtractionDouble())).rejects.toThrow(
      'Request failed with status code 429',
    );
  });

  it('rethrows other failures so the SDK reports them without saving state', async () => {
    jest.spyOn(HttpClient.prototype, 'getUsersPage').mockRejectedValue(httpError(500));
    const double = makeExtractionDouble();

    await expect(runExtraction(dataExtractionTask, double)).rejects.toThrow('Request failed with status code 500');
    expect(double.state.todos.completed).toBe(true);
    expect(double.state.users).toEqual({ completed: false, nextPage: 0 });
  });

  it('rejects an invalid checkpoint before fetching anything', async () => {
    const getTodosPage = jest.spyOn(HttpClient.prototype, 'getTodosPage');
    const double = makeExtractionDouble({
      state: { todos: { completed: false, nextPage: -1 } } as unknown as ExtractorState,
    });

    await expect(runExtraction(dataExtractionTask, double)).rejects.toThrow(INVALID_CHECKPOINT_MESSAGE);
    expect(double.initializeRepos).not.toHaveBeenCalled();
    expect(getTodosPage).not.toHaveBeenCalled();
  });

  it('fails when the connection token is missing', async () => {
    const double = makeExtractionDouble({ event: makeEvent('  ') });

    await expect(runExtraction(dataExtractionTask, double)).rejects.toThrow(
      'Invalid config: connection_data.key must be a non-empty string',
    );
  });
});

describe('external-sync-units-extraction worker', () => {
  it('pushes the normalized sync units and returns success', async () => {
    const double = makeExtractionDouble();

    await expect(runExtraction(externalSyncUnitsTask, double)).resolves.toEqual({ status: 'success' });
    const [batch] = pushedBatches(double, 'external_sync_units');
    expect(batch).toHaveLength(3);
    expect(batch[0]).toMatchObject({ id: 'list-1', name: 'Work Tasks', item_type: 'todos' });
  });
});

describe('metadata-extraction worker', () => {
  it('pushes the static domain metadata and returns success', async () => {
    const double = makeExtractionDouble();

    await expect(runExtraction(metadataExtractionTask, double)).resolves.toEqual({ status: 'success' });
    expect(pushedBatches(double, 'external_domain_metadata')).toHaveLength(1);
  });
});

describe('attachments-extraction worker', () => {
  const attachment = { id: 'att-1', url: 'https://example.com/file.txt' } as NormalizedAttachment;

  const captureStream = async (): Promise<ExternalSystemAttachmentStreamingFunction> => {
    const double = makeExtractionDouble();
    await runExtraction(attachmentsExtractionTask, double);
    return double.streamAttachments.mock.calls[0][0].stream;
  };

  const streamAttachment = async (): Promise<unknown> => {
    const stream = await captureStream();
    return stream({ item: attachment, event: makeEvent() });
  };

  it('returns the streamAttachments result unchanged', async () => {
    const double = makeExtractionDouble({
      streamAttachments: jest.fn().mockResolvedValue({ status: 'delay', delaySeconds: 5 }),
    });

    await expect(runExtraction(attachmentsExtractionTask, double)).resolves.toEqual({
      status: 'delay',
      delaySeconds: 5,
    });
  });

  it('maps a thrown rate limit to a delay and rethrows other failures', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const limited = makeExtractionDouble({
      streamAttachments: jest.fn().mockRejectedValue(httpError(429, { 'retry-after': '30' })),
    });
    const failing = makeExtractionDouble({
      streamAttachments: jest.fn().mockRejectedValue(new Error('pool exploded')),
    });

    await expect(runExtraction(attachmentsExtractionTask, limited)).resolves.toEqual({
      status: 'delay',
      delaySeconds: 30,
    });
    await expect(runExtraction(attachmentsExtractionTask, failing)).rejects.toThrow('pool exploded');
  });

  it('streams the attachment with a request timeout', async () => {
    const response = { data: 'stream', headers: {} };
    const get = jest.spyOn(axios, 'get').mockResolvedValue(response);

    await expect(streamAttachment()).resolves.toEqual({ status: 'success', httpStream: response });
    expect(get).toHaveBeenCalledWith(attachment.url, expect.objectContaining({ responseType: 'stream', timeout: 30000 }));
  });

  it('returns a delay for rate-limited downloads that send Retry-After', async () => {
    jest.spyOn(axios, 'get').mockRejectedValueOnce(httpError(429, { 'retry-after': '7' }));

    await expect(streamAttachment()).resolves.toEqual({ status: 'delay', delaySeconds: 7 });
  });

  it('fails the download instead of delaying forever when a 429 has no usable Retry-After', async () => {
    const get = jest.spyOn(axios, 'get');
    const expected = {
      status: 'error',
      error: {
        message:
          'Error while fetching attachment att-1 from URL. Error code: 429. Error message: Request failed with status code 429.',
      },
    };

    get.mockRejectedValueOnce(httpError(429));
    await expect(streamAttachment()).resolves.toEqual(expected);

    get.mockRejectedValueOnce(httpError(429, { 'retry-after': 'soon' }));
    await expect(streamAttachment()).resolves.toEqual(expected);
  });

  it('returns an error for other download failures', async () => {
    const get = jest.spyOn(axios, 'get');

    get.mockRejectedValueOnce(httpError(404, {}, { message: 'gone' }));
    await expect(streamAttachment()).resolves.toEqual({
      status: 'error',
      error: { message: 'Error while fetching attachment att-1 from URL. Error code: 404. Error message: gone.' },
    });

    get.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(streamAttachment()).resolves.toEqual({
      status: 'error',
      error: { message: 'Unknown error while fetching attachment att-1 from URL. Error: Error: socket hang up.' },
    });
  });
});

type LoadingDouble = {
  event: AirSyncEvent;
  state: LoaderState;
  loadItemTypes: jest.Mock<Promise<TaskResult>, [ItemTypesToLoadParams]>;
  loadAttachments: jest.Mock<Promise<TaskResult>, [{ create: ExternalSystemLoadingFunction<ExternalSystemAttachment> }]>;
};

const makeLoadingDouble = (overrides: Partial<LoadingDouble> = {}): LoadingDouble => ({
  event: makeEvent(),
  state: {},
  loadItemTypes: jest.fn().mockResolvedValue({ status: 'success' }),
  loadAttachments: jest.fn().mockResolvedValue({ status: 'success' }),
  ...overrides,
});

const runLoading = (task: LoadingTask, double: LoadingDouble): Promise<TaskResult> =>
  task({ adapter: double as unknown as LoadingAdapter<LoaderState> });

const loadingParams = <Item>(item: Item): ExternalSystemItemLoadingParams<Item> =>
  ({ item, mappers: {}, event: makeEvent() }) as unknown as ExternalSystemItemLoadingParams<Item>;

const todoItem: ExternalSystemItem = {
  id: { devrev: 'todo-1' },
  created_date: '2024-01-01T00:00:00Z',
  modified_date: '2024-01-02T00:00:00Z',
  data: { title: 'Updated todo', body: 'Body', creator: 'user-1', owner: 'user-2' },
};

const attachmentItem: ExternalSystemAttachment = {
  reference_id: 'don:core:dvrv-us-1:devo/1:artifact/1',
  parent_type: 'work',
  parent_reference_id: 'don:core:dvrv-us-1:devo/1:issue/1',
  file_name: 'file.txt',
  file_type: 'text/plain',
  file_size: 12,
  url: 'https://example.com/file.txt',
  valid_until: '2027-01-01T00:00:00Z',
  created_by_id: 'user-1',
  created_date: '2024-01-01T00:00:00Z',
  modified_by_id: 'user-1',
  modified_date: '2024-01-01T00:00:00Z',
};

describe('load-data worker', () => {
  const captureTodoLoaders = async (): Promise<ItemTypesToLoadParams['itemTypesToLoad'][number]> => {
    const double = makeLoadingDouble();
    await runLoading(loadDataTask, double);
    return double.loadItemTypes.mock.calls[0][0].itemTypesToLoad[0];
  };

  it('returns the loadItemTypes result unchanged', async () => {
    const double = makeLoadingDouble({
      loadItemTypes: jest.fn().mockResolvedValue({ status: 'delay', delaySeconds: 4 }),
    });

    await expect(runLoading(loadDataTask, double)).resolves.toEqual({ status: 'delay', delaySeconds: 4 });
    expect(double.loadItemTypes.mock.calls[0][0].itemTypesToLoad.map(({ itemType }) => itemType)).toEqual(['todos']);
  });

  it('updates todos in the external system', async () => {
    const { update } = await captureTodoLoaders();

    await expect(update(loadingParams(todoItem))).resolves.toEqual({ status: 'success', id: 'todo-1' });
  });

  it('creates todos in the external system', async () => {
    // Keeps the shared in-memory store unchanged for extraction tests.
    const createTodo = jest
      .spyOn(HttpClient.prototype, 'createTodo')
      .mockResolvedValue({ status: 'success', id: 'todo-new' });
    const { create } = await captureTodoLoaders();

    await expect(create(loadingParams(todoItem))).resolves.toEqual({ status: 'success', id: 'todo-new' });
    expect(createTodo).toHaveBeenCalledWith(expect.objectContaining({ id: 'todo-1', title: 'Updated todo' }));
  });

  it('returns a delay instead of throwing when rate limited', async () => {
    jest.spyOn(HttpClient.prototype, 'createTodo').mockRejectedValue(httpError(429, { 'retry-after': '9' }));
    const { create } = await captureTodoLoaders();

    await expect(create(loadingParams(todoItem))).resolves.toEqual({ status: 'delay', delaySeconds: 9 });
  });

  it('returns an item error instead of throwing on other failures', async () => {
    jest.spyOn(HttpClient.prototype, 'updateTodo').mockRejectedValue(new Error('external system down'));
    const { update } = await captureTodoLoaders();

    await expect(update(loadingParams(todoItem))).resolves.toEqual({
      status: 'error',
      error: { message: 'update todo: external system down' },
    });
  });

  it('reports a missing todo as an item error', async () => {
    const { update } = await captureTodoLoaders();

    await expect(update(loadingParams({ ...todoItem, id: { devrev: 'todo-missing' } }))).resolves.toEqual({
      status: 'error',
      error: { message: 'Todo with id "todo-missing" not found in external system.' },
    });
  });
});

describe('load-attachments worker', () => {
  const captureCreate = async () => {
    const double = makeLoadingDouble();
    await runLoading(loadAttachmentsTask, double);
    return double.loadAttachments.mock.calls[0][0].create;
  };

  it('returns the loadAttachments result unchanged', async () => {
    const double = makeLoadingDouble({
      loadAttachments: jest.fn().mockResolvedValue({ status: 'error', error: { message: 'boom' } }),
    });

    await expect(runLoading(loadAttachmentsTask, double)).resolves.toEqual({
      status: 'error',
      error: { message: 'boom' },
    });
  });

  it('creates attachments in the external system', async () => {
    const create = await captureCreate();

    await expect(create(loadingParams(attachmentItem))).resolves.toEqual({
      status: 'success',
      id: attachmentItem.reference_id,
    });
  });

  it('returns a delay or an item error instead of throwing', async () => {
    const createAttachment = jest.spyOn(HttpClient.prototype, 'createAttachment');
    const create = await captureCreate();

    createAttachment.mockRejectedValueOnce(httpError(429, { 'retry-after': '3' }));
    await expect(create(loadingParams(attachmentItem))).resolves.toEqual({ status: 'delay', delaySeconds: 3 });

    createAttachment.mockRejectedValueOnce(httpError(502));
    await expect(create(loadingParams(attachmentItem))).resolves.toEqual({
      status: 'error',
      error: { message: 'create attachment (HTTP 502): Request failed with status code 502' },
    });
  });
});
