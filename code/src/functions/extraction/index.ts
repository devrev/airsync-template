import { AirSyncEvent, spawn } from '@devrev/airsync-sdk';

import initialDomainMapping from '../external-system/initial_domain_mapping.json';

export interface ExtractorState {
  runId: string;
  cursor: string | null;
  completed: boolean;
}

export const initialExtractorState: ExtractorState = {
  runId: '',
  cursor: null,
  completed: false,
};

export default async function run(events: AirSyncEvent[]) {
  for (const event of events) {
    await spawn<ExtractorState>({
      event,
      initialState: initialExtractorState,
      initialDomainMapping,
      baseWorkerPath: __dirname,
    });
  }
}
