import { ExternalSyncUnit, NormalizedItem } from '@devrev/airsync-sdk';

import { validateTask } from './http-client';
import { SourceProject } from './types';

export function normalizeProject(project: SourceProject): ExternalSyncUnit {
  return { ...project, item_type: 'tasks' };
}

export function normalizeTask(record: object): NormalizedItem {
  validateTask(record);
  return {
    id: record.id,
    created_date: new Date(record.created_at).toISOString(),
    modified_date: new Date(record.updated_at).toISOString(),
    data: { title: record.title },
  };
}
