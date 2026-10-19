import { ExtractionAdapter, processExtractionTask } from '@devrev/airsync-sdk';

import { normalizeAttachment, normalizeTodo, normalizeUser } from '../../external-system/data-normalization';
import {
  MAX_PAGES_PER_INVOCATION,
  decodeExtractorState,
  toRateLimitDelay,
} from '../../external-system/guards';
import { HttpClient, PageResult } from '../../external-system/http-client';
import { ExtractorState, initialExtractorState } from '../index';
import { ExternalTodo, ExternalUser, ExternalAttachment } from '../../external-system/types';

// TODO: Replace with actual repos that will be used to store the
// data extracted from the external system. For example, you might want to
// create repos for todos, users, and attachments. Also replace and modify
// the normalization functions which are used to normalize the data.
const repos = [
  {
    itemType: 'todos',
    normalize: (item: object) => normalizeTodo(item as ExternalTodo),
  },
  {
    itemType: 'users',
    normalize: (item: object) => normalizeUser(item as ExternalUser),
  },
  {
    itemType: 'attachments',
    normalize: (item: object) => normalizeAttachment(item as ExternalAttachment),
  },
];

// TODO: Replace with item types you want to extract from the external system.
// Also replace the fetch functions with the actual functions that will be
// used to fetch one page of data.
interface ItemTypeToExtract {
  name: 'todos' | 'users' | 'attachments';
  fetchPage: (client: HttpClient, page: number) => Promise<PageResult<object>>;
}

const itemTypesToExtract: ItemTypeToExtract[] = [
  {
    name: 'todos',
    fetchPage: (client, page) => client.getTodosPage(page),
  },
  {
    name: 'users',
    fetchPage: (client, page) => client.getUsersPage(page),
  },
  {
    name: 'attachments',
    fetchPage: (client, page) => client.getAttachmentsPage(page),
  },
];

async function extractPages(
  adapter: ExtractionAdapter<ExtractorState>,
  httpClient: HttpClient,
  itemType: ItemTypeToExtract,
  pageBudget: number,
): Promise<{ pagesUsed: number; finished: boolean }> {
  const bucket = adapter.state[itemType.name];
  const repo = adapter.getRepo(itemType.name);
  if (!repo) {
    throw new Error(`No repo initialized for item type ${itemType.name}`);
  }
  let pagesUsed = 0;
  while (!bucket.completed) {
    if (adapter.isTimeout || pagesUsed >= pageBudget) {
      return { pagesUsed, finished: false };
    }
    const page = bucket.nextPage ?? 0;
    const result = await itemType.fetchPage(httpClient, page);
    if (result.items.length > 0) {
      await repo.push(result.items);
    }
    pagesUsed += 1;
    bucket.nextPage = page + 1;
    bucket.completed = !result.hasMore || result.items.length === 0;
  }
  return { pagesUsed, finished: true };
}

// State persists across runs; only a new run starts over.
function stateForRun(persisted: ExtractorState, runId: string): ExtractorState {
  if (persisted.runId === runId) {
    return persisted;
  }
  const { todos, users, attachments } = structuredClone(initialExtractorState);
  return { ...persisted, runId, todos, users, attachments };
}

processExtractionTask<ExtractorState>({
  task: async ({ adapter }) => {
    try {
      adapter.state = stateForRun(decodeExtractorState(adapter.state), adapter.event.payload.event_context.run_id);
      adapter.initializeRepos(repos);

      // TODO: Replace with the HTTP client that will be used to make API calls
      // to the external system.
      const httpClient = new HttpClient(adapter.event);

      // TODO: Replace with your implementation to extract data from the external
      // system. This is just an example how you can iterate over the item types,
      // extract them, push them to the repo, and save the state.
      let pageBudget = MAX_PAGES_PER_INVOCATION;
      for (const itemTypeToExtract of itemTypesToExtract) {
        if (!adapter.shouldExtract(itemTypeToExtract.name)) {
          adapter.state[itemTypeToExtract.name].completed = true;
          continue;
        }

        const { pagesUsed, finished } = await extractPages(adapter, httpClient, itemTypeToExtract, pageBudget);
        pageBudget -= pagesUsed;
        if (!finished) {
          return { status: 'progress' };
        }
      }

      return { status: 'success' };
    } catch (error) {
      // Rethrown so the SDK reports it without saving state.
      const delay = toRateLimitDelay(error);
      if (delay) {
        return delay;
      }
      throw error;
    }
  },
});
