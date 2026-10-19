import { AirSyncEvent, spawn } from '@devrev/airsync-sdk';

import initialDomainMapping from '../external-system/initial_domain_mapping.json';

// TODO: Replace with your state interface that will keep track of the
// extraction progress. For example, the page number, the number of items
// processed, if the extraction is completed, etc. `nextPage` is the first page
// not yet pushed, so a continued invocation resumes where the last one stopped.
// State persists across sync runs; `runId` records which run the progress
// belongs to, so a new run starts over while continuations and replayed events
// of the same run resume.
export interface ExtractorState {
  runId?: string;
  todos: { completed: boolean; nextPage?: number };
  users: { completed: boolean; nextPage?: number };
  attachments: { completed: boolean; nextPage?: number };
}

// TODO: Replace with your initial state that will be passed to the worker.
// This state will be used as a starting point for the extraction process.
export const initialExtractorState: ExtractorState = {
  todos: { completed: false, nextPage: 0 },
  users: { completed: false, nextPage: 0 },
  attachments: { completed: false, nextPage: 0 },
};

const run = async (events: AirSyncEvent[]) => {
  for (const event of events) {
    await spawn<ExtractorState>({
      event,
      initialState: initialExtractorState,
      initialDomainMapping,
      baseWorkerPath: __dirname,

      // TODO: If needed you can pass additional options to the spawn function.
      // For example timeout of the lambda, batch size, etc.
      // options: {
      //   timeout: 1 * 1000 * 60, // 1 minute
      //   batchSize: 50, // 50 items per batch
      // },
    });
  }
};

export default run;
