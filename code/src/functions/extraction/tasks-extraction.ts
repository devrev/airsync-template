import { ExtractionAdapter, TaskResult } from '@devrev/airsync-sdk';

import { normalizeTask } from '../external-system/data-normalization';
import { HttpClient, SourceHttpError } from '../external-system/http-client';
import type { ExtractorState } from './index';

export async function extractTasks(adapter: ExtractionAdapter<ExtractorState>): Promise<TaskResult> {
  const context = adapter.event.payload.event_context;
  if (!context.run_id) throw new Error('Extraction run ID is missing');
  if (adapter.state.runId !== context.run_id) {
    adapter.state = { runId: context.run_id, cursor: null, completed: false };
  }
  if (!adapter.shouldExtract('tasks') || adapter.state.completed) return { status: 'success' };
  if (adapter.isTimeout) return { status: 'progress' };

  let page;
  try {
    page = await new HttpClient(adapter.event).getTasks(adapter.state.cursor);
  } catch (error) {
    if (error instanceof SourceHttpError) {
      if (error.status === 429) return { status: 'delay', delaySeconds: error.delaySeconds };
      return { status: 'error', error: { message: error.message } };
    }
    throw error;
  }

  adapter.initializeRepos([{ itemType: 'tasks', normalize: normalizeTask }]);
  const repo = adapter.getRepo('tasks');
  if (!repo) throw new Error('Tasks repo is missing');
  await repo.push(page.items);
  await repo.upload();
  adapter.state.cursor = page.next_cursor;
  adapter.state.completed = page.next_cursor === null;
  return { status: adapter.state.completed ? 'success' : 'progress' };
}
