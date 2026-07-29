import axios from 'axios';

import {
  ExternalSystemAttachmentStreamingParams,
  ExternalSystemAttachmentStreamingResponse,
  processExtractionTask,
} from '@devrev/airsync-sdk';

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
      headers: {
        'Accept-Encoding': 'identity',
        timeout: 30000,
      },
    });

    return { httpStream: fileStreamResponse };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error?.response?.status === 429) {
        const retryAfter = error.response?.headers['retry-after'];
        return { delay: retryAfter };
      } else {
        return {
          error: {
            message: `Error while fetching attachment ${id} from URL. Error code: ${error.response?.status}. Error message: ${error.response?.data.message}.`,
          },
        };
      }
    }

    return {
      error: {
        message: `Unknown error while fetching attachment ${id} from URL. Error: ${error}.`,
      },
    };
  }
}

processExtractionTask({
  task: async ({ adapter }) => {
    return adapter.streamAttachments({
      stream: getFileStream,

      // TODO: If needed you can specify how many attachments to stream at
      // once. Minimum is 1 and maximum is 50.
      // batchSize: 10,
    });
  },
});
