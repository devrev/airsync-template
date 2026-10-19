import {
  ExternalSystemItem,
  ExternalSystemItemLoadingParams,
  ExternalSystemItemLoadingResponse,
  processLoadingTask,
} from '@devrev/airsync-sdk';

import { denormalizeTodo } from '../../external-system/data-denormalization';
import { toFailureResult } from '../../external-system/guards';
import { HttpClient } from '../../external-system/http-client';
import { LoaderState } from '../index';

/* eslint-disable @typescript-eslint/no-unused-vars */

// TODO: Replace with your create function that will be used to make API calls
// to the external system to create a new item. Return a status with an id,
// error or delaySeconds depending on the response from the external system.
async function createTodo({
  item,
  mappers,
  event,
}: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
  // TODO: Replace with your HTTP client that will be used to make API calls
  // to the external system.
  const httpClient = new HttpClient(event);
  const todo = denormalizeTodo(item);

  try {
    return await httpClient.createTodo(todo);
  } catch (error) {
    // A throw here would fail the whole loading phase. A rate limit becomes a
    // delay, so loading pauses and resumes at this item; any other failure
    // only marks this item as failed.
    return toFailureResult(error, 'create todo');
  }
}

// TODO: Replace with your update function that will be used to make API calls
// to the external system to update an existing item. Return a status with an
// id, error or delaySeconds depending on the response from the external system.
async function updateTodo({
  item,
  mappers,
  event,
}: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
  // TODO: Replace with your HTTP client that will be used to make API calls
  // to the external system.
  const httpClient = new HttpClient(event);

  // TODO: In case you need to get the external id of the item, you can use
  // the mappers.getByTargetId function to get the sync mapper record
  // for the item. The sync mapper record will contain the external id of
  // the item in the external system.
  // const syncMapperRecordResponse = await mappers.getByTargetId({
  //   sync_unit: event.payload.event_context.sync_unit,
  //   target: item.id.devrev,
  // });
  // const todoExternalId = syncMapperRecordResponse?.sync_mapper_record.external_ids[0];

  const todo = denormalizeTodo(item);

  try {
    return await httpClient.updateTodo(todo);
  } catch (error) {
    return toFailureResult(error, 'update todo');
  }
}

processLoadingTask<LoaderState>({
  task: async ({ adapter }) => {
    return adapter.loadItemTypes({
      itemTypesToLoad: [
        {
          itemType: 'todos',
          create: createTodo,
          update: updateTodo,
        },
      ],
    });
  },
});
