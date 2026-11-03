import * as fs from 'fs';
import * as path from 'path';

export function resolveFixturePath(fixturesRoot: string, filePath: string): string {
  const root = fs.realpathSync(fixturesRoot);
  const resolved = path.resolve(root, filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Fixture path must stay inside the fixtures directory.');
  }
  if (!fs.existsSync(resolved)) {
    return resolved;
  }
  const canonical = fs.realpathSync(resolved);
  if (canonical !== root && !canonical.startsWith(`${root}${path.sep}`)) {
    throw new Error('Fixture path must stay inside the fixtures directory.');
  }
  return canonical;
}

export function readFixtureFile<T>(fixturesRoot: string, filePath: string): T | undefined {
  const resolved = resolveFixturePath(fixturesRoot, filePath);
  if (!fs.existsSync(resolved)) {
    return undefined;
  }
  const raw = fs.readFileSync(resolved, 'utf-8').trim();
  if (raw.length === 0) {
    return undefined;
  }
  const substituted = raw.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      throw new Error(`Environment variable "${varName}" referenced in fixture is not set.`);
    }
    return JSON.stringify(value).slice(1, -1);
  });
  return JSON.parse(substituted) as T;
}
