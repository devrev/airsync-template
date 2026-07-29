import { processExtractionTask } from '@devrev/airsync-sdk';

import staticExternalDomainMetadata from '../../external-system/external_domain_metadata.json';

const repos = [
  {
    itemType: 'external_domain_metadata',
  },
];

processExtractionTask({
  task: async ({ adapter }) => {
    adapter.initializeRepos(repos);

    // TODO: If needed, add handling for dynamic external domain metadata
    // extraction here. For example, you might want to call an external system API to
    // get custom fields and their values and append them to the static
    // external domain metadata.
    const externalDomainMetadata = {
      ...staticExternalDomainMetadata,
    };

    await adapter.getRepo('external_domain_metadata')?.push([externalDomainMetadata]);
    return { status: 'success' };
  },
  onTimeout: async () => ({
    status: 'error',
    error: { message: 'Failed to extract metadata. Lambda timeout.' },
  }),
});
