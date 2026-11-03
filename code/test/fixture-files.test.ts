import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { readFixtureFile, resolveFixturePath } from '../src/test-runner/fixture-files';

let temporaryDir: string;
let fixturesRoot: string;

beforeEach(() => {
  temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airsync-fixtures-'));
  fixturesRoot = path.join(temporaryDir, 'fixtures');
  fs.mkdirSync(path.join(fixturesRoot, 'nested'), { recursive: true });
  fs.mkdirSync(path.join(temporaryDir, 'fixtures-other'));
  fs.writeFileSync(path.join(fixturesRoot, 'nested/event.json'), '{"ok":true}');
  fs.writeFileSync(path.join(temporaryDir, 'event.json'), '{"private":true}');
  fs.writeFileSync(path.join(temporaryDir, 'fixtures-other/event.json'), '{"private":true}');
});

afterEach(() => {
  fs.rmSync(temporaryDir, { recursive: true, force: true });
  delete process.env.AIRSYNC_TEST_FIXTURE_VALUE;
});

test('reads nested fixtures and permits symlinks that stay inside the root', () => {
  fs.symlinkSync(path.join(fixturesRoot, 'nested'), path.join(fixturesRoot, 'alias'));
  expect(readFixtureFile(fixturesRoot, 'nested/event.json')).toEqual({ ok: true });
  expect(readFixtureFile(fixturesRoot, 'alias/event.json')).toEqual({ ok: true });
});

test.each(['../event.json', '../fixtures-other/event.json'])('rejects traversal outside the root: %s', (filePath) => {
  expect(() => readFixtureFile(fixturesRoot, filePath)).toThrow('inside the fixtures directory');
});

test('rejects absolute paths outside the root', () => {
  expect(() => readFixtureFile(fixturesRoot, path.join(temporaryDir, 'event.json'))).toThrow('inside the fixtures directory');
});

test('rejects a fixture directory symlink outside the root', () => {
  fs.symlinkSync(temporaryDir, path.join(fixturesRoot, 'outside'));
  expect(() => resolveFixturePath(fixturesRoot, 'outside')).toThrow('inside the fixtures directory');
  expect(() => readFixtureFile(fixturesRoot, 'outside/event.json')).toThrow('inside the fixtures directory');
});

test('rejects an individual fixture file symlink outside the root', () => {
  fs.symlinkSync(path.join(temporaryDir, 'event.json'), path.join(fixturesRoot, 'nested/state.json'));
  expect(() => readFixtureFile(fixturesRoot, 'nested/state.json')).toThrow('inside the fixtures directory');
});

test('preserves missing and empty optional fixtures', () => {
  fs.writeFileSync(path.join(fixturesRoot, 'empty.json'), '  ');
  expect(readFixtureFile(fixturesRoot, 'missing.json')).toBeUndefined();
  expect(readFixtureFile(fixturesRoot, 'empty.json')).toBeUndefined();
});

test('resolves environment placeholders without breaking JSON escaping', () => {
  process.env.AIRSYNC_TEST_FIXTURE_VALUE = 'a"b\\c';
  fs.writeFileSync(path.join(fixturesRoot, 'env.json'), '{"value":"${AIRSYNC_TEST_FIXTURE_VALUE}"}');
  expect(readFixtureFile(fixturesRoot, 'env.json')).toEqual({ value: process.env.AIRSYNC_TEST_FIXTURE_VALUE });
});

test('rejects missing environment placeholders', () => {
  fs.writeFileSync(path.join(fixturesRoot, 'env.json'), '{"value":"${AIRSYNC_TEST_FIXTURE_VALUE}"}');
  expect(() => readFixtureFile(fixturesRoot, 'env.json')).toThrow('is not set');
});
