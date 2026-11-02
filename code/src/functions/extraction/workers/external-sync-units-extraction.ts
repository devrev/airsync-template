import { AirSyncDefaultItemTypes, processExtractionTask } from '@devrev/airsync-sdk';

import { normalizeProject } from '../../external-system/data-normalization';
import { HttpClient } from '../../external-system/http-client';

processExtractionTask({
  task: async ({ adapter }) => {
    const projects = await new HttpClient(adapter.event).getProjects();
    adapter.initializeRepos([{ itemType: AirSyncDefaultItemTypes.EXTERNAL_SYNC_UNITS }]);
    const repo = adapter.getRepo(AirSyncDefaultItemTypes.EXTERNAL_SYNC_UNITS);
    if (!repo) throw new Error('External sync units repo is missing');
    await repo.push(projects.map(normalizeProject));
    await repo.upload();
    return { status: 'success' };
  },
});
