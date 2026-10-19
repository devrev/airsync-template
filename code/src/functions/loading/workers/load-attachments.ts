import {
  ExternalSystemAttachment,
  ExternalSystemItemLoadingParams,
  ExternalSystemItemLoadingResponse,
  processLoadingTask,
} from '@devrev/airsync-sdk';

import { denormalizeAttachment } from '../../external-system/data-denormalization';
import { toFailureResult } from '../../external-system/guards';
import { HttpClient } from '../../external-system/http-client';
import { LoaderState } from '../index';

/* eslint-disable @typescript-eslint/no-unused-vars */

// TODO: Replace with your create function that will be used to make API calls
// to the external system to create a new attachment. Function must return
// a status with an id or error depending on the response from the external system.
async function createAttachment({
  item,
  mappers,
  event,
}: ExternalSystemItemLoadingParams<ExternalSystemAttachment>): Promise<ExternalSystemItemLoadingResponse> {
  // TODO: Replace with your HTTP client that will be used to make API calls
  // to the external system.
  const httpClient = new HttpClient(event);
  const attachment = denormalizeAttachment(item);

  try {
    return await httpClient.createAttachment(attachment);
  } catch (error) {
    // A throw here would fail the whole loading phase. A rate limit becomes a
    // delay, so loading pauses and resumes at this attachment; any other
    // failure only marks this attachment as failed.
    return toFailureResult(error, 'create attachment');
  }
}

processLoadingTask<LoaderState>({
  task: async ({ adapter }) => {
    return adapter.loadAttachments({
      create: createAttachment,
    });
  },
});
