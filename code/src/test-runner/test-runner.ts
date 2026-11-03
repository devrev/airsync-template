import * as dotenv from 'dotenv';
import * as path from 'path';

import { AirSyncEvent, createMockEvent, DeepPartial, EventType, MockServer } from '@devrev/airsync-sdk';

import { functionFactory, FunctionFactoryType } from '../function-factory';
import { readFixtureFile, resolveFixturePath } from './fixture-files';

export interface LocalRunnerProps {
  fixturePath: string;
  functionName?: FunctionFactoryType;
}

function resolveEventType(input: string): EventType {
  const match = Object.values(EventType).find((v) => v === input);
  if (match) return match as EventType;

  throw new Error(`Unknown event_type "${input}". Must be one of: ${Object.values(EventType).join(', ')}`);
}

export const testRunner = async ({ fixturePath, functionName }: LocalRunnerProps) => {
  dotenv.config();

  const fixturesRoot = path.resolve(__dirname, '../../fixtures');
  const fixturesDir = resolveFixturePath(fixturesRoot, fixturePath);
  return runWithFixtureDir(fixturesRoot, fixturesDir, functionName);
};

function getFunctionName(event_type: string): FunctionFactoryType {
  if (event_type.indexOf('EXTRACT') != -1) {
    return 'extraction';
  } else if (event_type.indexOf('LOAD') != -1) {
    return 'loading';
  }

  throw new Error(`No functionName found for event ${event_type}. Specify functionName using '--functionName' parameter.`);
}

async function runWithFixtureDir(fixturesRoot: string, fixturesDir: string, functionName?: FunctionFactoryType) {
  const eventPath = path.join(fixturesDir, 'event.json');
  const statePath = path.join(fixturesDir, 'state.json');
  const extractionScopePath = path.join(fixturesDir, 'extraction_scope.json');

  const fixtureEvent = readFixtureFile<DeepPartial<AirSyncEvent>>(fixturesRoot, eventPath);
  const fixtureState = readFixtureFile<Record<string, unknown>>(fixturesRoot, statePath);
  const fixtureExtractionScope = readFixtureFile<Record<string, unknown>>(fixturesRoot, extractionScopePath);

  if (!fixtureEvent) {
    throw new Error(
      `Missing or empty event.json in fixture directory: ${eventPath}. ` +
      'Every fixture must have an event.json with at least an "event_type" field.'
    );
  }

  if (!fixtureEvent.payload?.event_type) {
    throw new Error(
      `event.json at ${eventPath} is missing the required "event_type" field. ` +
      'Specify an event type such as "START_EXTRACTING_DATA" or "START_EXTRACTING_EXTERNAL_SYNC_UNITS".'
    );
  }

  const resolvedFunctionName = functionName ?? getFunctionName(fixtureEvent.payload?.event_type);

  if (!resolvedFunctionName) {
    throw new Error(
      'No function name provided. Pass --functionName on the CLI'
    );
  }

  if (!(resolvedFunctionName in functionFactory)) {
    throw new Error(
      `Function "${resolvedFunctionName}" not found in functionFactory. ` +
      `Available: ${Object.keys(functionFactory).join(', ')}`
    );
  }

  const eventType = resolveEventType(fixtureEvent.payload?.event_type);

  console.log(`[test-runner] Function : ${resolvedFunctionName}`);
  console.log(`[test-runner] Event    : ${eventType}`);
  console.log(`[test-runner] Fixture  : ${fixturesDir}`);

  const mockServer = new MockServer(0);
  await mockServer.start();

  console.log(`[test-runner] MockServer started on ${mockServer.baseUrl}`);

  mockServer.setRoute({
    path: '/worker_data_url.get',
    method: 'GET',
    status: 200,
    body: {
      state: JSON.stringify(fixtureState ?? {}),
      objects: JSON.stringify(fixtureExtractionScope ?? {}),
    },
  });

  if (fixtureState) {
    console.log(`[test-runner] Injected state from state.json`);
  } else {
    console.log(`[test-runner] No state.json found — using default empty state`);
  }

  if (fixtureExtractionScope) {
    console.log(`[test-runner] Injected extraction scope from extraction_scope.json`);
  } else {
    console.log(`[test-runner] No extraction_scope.json found — using default all-extract scope`);
  }

  const event = createMockEvent(mockServer.baseUrl, fixtureEvent);

  process.env.AIRSYNC_LOCAL_DEVELOPMENT = '1';

  const run = functionFactory[resolvedFunctionName];

  try {
    await run([event]);
    console.log(`[test-runner] Function completed successfully`);
  } catch (err) {
    console.error(`[test-runner] Function threw an error:`, err);
    process.exitCode = 1;
  } finally {
    await mockServer.stop();
    console.log(`[test-runner] MockServer stopped`);
  }
}
