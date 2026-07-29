import {
  AirSyncDefaultItemTypes,
  ExternalSyncUnit,
  processExtractionTask,
} from '@devrev/airsync-sdk';

import { normalizeTodoList } from '../../external-system/data-normalization';
import { HttpClient } from '../../external-system/http-client';

processExtractionTask({
  task: async ({ adapter }) => {
    adapter.initializeRepos([
      {
        itemType: AirSyncDefaultItemTypes.EXTERNAL_SYNC_UNITS,
        overridenOptions: {
          batchSize: 25000,
          skipConfirmation: true,
        },
      },
    ]);

    // TODO: Replace with HTTP client that will be used to make API calls
    // to the external system.
    const httpClient = new HttpClient(adapter.event);

    // TODO: Replace with actual API call to fetch external sync units.
    const todoLists = await httpClient.getTodoLists();

    // TODO: Normalize the data received from the API call to match the
    // ExternalSyncUnit interface. Modify the normalization function to suit
    // your needs.
    const externalSyncUnits: ExternalSyncUnit[] = todoLists.map((todoList) => normalizeTodoList(todoList));

    await adapter
      .getRepo(AirSyncDefaultItemTypes.EXTERNAL_SYNC_UNITS)
      ?.push(externalSyncUnits);

    return { status: 'success' };
  },
  onTimeout: async () => ({
    status: 'error',
    error: {
      message: 'Failed to extract external sync units. Lambda timeout.',
    },
  }),
});
