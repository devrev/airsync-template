import { processExtractionTask } from '@devrev/airsync-sdk';

import externalDomainMetadata from '../../external-system/external_domain_metadata.json';

processExtractionTask({
  task: async ({ adapter }) => {
    adapter.initializeRepos([{ itemType: 'external_domain_metadata' }]);
    const repo = adapter.getRepo('external_domain_metadata');
    if (!repo) throw new Error('Metadata repo is missing');
    await repo.push([externalDomainMetadata]);
    await repo.upload();
    return { status: 'success' };
  },
});
