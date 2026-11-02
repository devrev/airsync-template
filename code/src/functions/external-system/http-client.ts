import { AirSyncEvent } from '@devrev/airsync-sdk';

import sourceConfig from './source-config.json';
import { SourceProject, SourceTask, TaskPage } from './types';

export class SourceHttpError extends Error {
  constructor(public readonly status: number, public readonly delaySeconds = 30) {
    super(`Source HTTP ${status}`);
  }
}

export function validateTask(value: unknown): asserts value is SourceTask {
  if (!value || typeof value !== 'object') throw new Error('Invalid source task');
  const task = value as Partial<SourceTask>;
  if (typeof task.id !== 'string' || !task.id ||
      typeof task.title !== 'string' || !task.title.trim() ||
      typeof task.created_at !== 'string' || !Number.isFinite(Date.parse(task.created_at)) ||
      typeof task.updated_at !== 'string' || !Number.isFinite(Date.parse(task.updated_at))) {
    throw new Error('Invalid source task');
  }
}

export class HttpClient {
  private readonly origin: string;
  private readonly token: string;

  constructor(private readonly event: AirSyncEvent) {
    this.origin = process.env.EXAMPLE_API_ORIGIN || sourceConfig.origin;
    this.token = event.payload.connection_data.key;
    const url = new URL(this.origin);
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
      throw new Error('Source origin must use HTTPS or local HTTP');
    }
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Source origin must contain only a scheme, hostname, and optional port');
    }
    if (!this.token) throw new Error('Source API token is missing from the connection');
  }

  private async get(url: URL): Promise<unknown> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });
    if (!response.ok) {
      const header = response.headers.get('retry-after');
      const numeric = header === null || !header.trim() ? NaN : Number(header);
      const delay = Number.isFinite(numeric)
        ? numeric
        : Math.ceil((Date.parse(header ?? '') - Date.now()) / 1000);
      throw new SourceHttpError(response.status, Number.isFinite(delay) && delay > 0 ? delay : 30);
    }
    return response.json();
  }

  async getProjects(): Promise<SourceProject[]> {
    const response = await this.get(new URL('/projects', this.origin));
    if (!Array.isArray(response) || response.some((project: Partial<SourceProject> | null) =>
      !project || typeof project.id !== 'string' || !project.id ||
      typeof project.name !== 'string' || !project.name.trim() ||
      typeof project.description !== 'string' ||
      !Number.isSafeInteger(project.item_count) || (project.item_count ?? -1) < 0)) {
      throw new Error('Invalid source projects');
    }
    return response;
  }

  async getTasks(cursor: string | null): Promise<TaskPage> {
    const context = this.event.payload.event_context;
    if (!context.external_sync_unit_id) throw new Error('Source project ID is missing');
    const url = new URL('/tasks', this.origin);
    url.searchParams.set('project_id', context.external_sync_unit_id);
    url.searchParams.set('limit', '3');
    if (cursor) url.searchParams.set('cursor', cursor);
    if (context.extract_from) url.searchParams.set('updated_from', context.extract_from);
    if (context.extract_to) url.searchParams.set('updated_to', context.extract_to);
    const page = await this.get(url) as Partial<TaskPage> | null;
    if (!page || !Array.isArray(page.items) ||
        !(page.next_cursor === null || (typeof page.next_cursor === 'string' && page.next_cursor.length > 0))) {
      throw new Error('Invalid source page');
    }
    if (page.next_cursor !== null && page.next_cursor === cursor) {
      throw new Error('Source pagination cursor did not advance');
    }
    if (page.next_cursor !== null && page.items.length === 0) {
      throw new Error('Source pagination returned an empty continuation page');
    }
    page.items.forEach(validateTask);
    return page as TaskPage;
  }
}
