import { processExtractionTask } from '@devrev/airsync-sdk';

import type { ExtractorState } from '../index';
import { extractTasks } from '../tasks-extraction';

processExtractionTask<ExtractorState>({ task: ({ adapter }) => extractTasks(adapter) });
