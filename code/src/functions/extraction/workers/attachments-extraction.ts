import axios from 'axios';

import {
  ExternalSystemAttachmentStreamingParams,
  ExternalSystemAttachmentStreamingResponse,
  processExtractionTask,
} from '@devrev/airsync-sdk';

import { parseRetryAfter, readResponseHeader, toRateLimitDelay } from '../../external-system/guards';

// TODO: Replace with function for fetching attachment streams from the
// external system. This function should return either a stream of the
// attachment data, a delay or an error.
async function getFileStream({
  item,
}: ExternalSystemAttachmentStreamingParams): Promise<ExternalSystemAttachmentStreamingResponse> {
  const { id, url } = item;

  try {
    const fileStreamResponse = await axios.get(url, {
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'Accept-Encoding': 'identity',
      },
    });

    return { status: 'success', httpStream: fileStreamResponse };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 429) {
        return { status: 'delay', delaySeconds: parseRetryAfter(readResponseHeader(error, 'retry-after')) };
      }

      return {
        status: 'error',
        error: {
          message: `Error while fetching attachment ${id} from URL. Error code: ${error.response?.status}. Error message: ${error.response?.data?.message || error.message}.`,
        },
      };
    }

    return {
      status: 'error',
      error: {
        message: `Unknown error while fetching attachment ${id} from URL. Error: ${error}.`,
      },
    };
  }
}

processExtractionTask({
  task: async ({ adapter }) => {
    try {
      return await adapter.streamAttachments({
        stream: getFileStream,

        // TODO: If needed you can specify how many attachments to stream at
        // once. Minimum is 1 and maximum is 50.
        // batchSize: 10,
      });
    } catch (error) {
      console.error('An error occured while processing a task.', error);
      const delay = toRateLimitDelay(error);
      if (delay) {
        return delay;
      }
      throw error;
    }
  },
});
