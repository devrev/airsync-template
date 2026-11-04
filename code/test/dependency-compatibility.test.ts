import path from 'node:path';

const match = require('nodemon/lib/monitor/match');

describe('nodemon with patched minimatch', () => {
  it('watches TypeScript and dotfiles while respecting ignored paths', () => {
    const result = match(
      ['src/main.ts', 'src/main.js', 'test/runner.ts', 'src/.hidden.ts'],
      ['!**/test/**', '**/src/**'],
      'ts'
    );

    expect(result.result).toEqual([path.resolve('src/main.ts'), path.resolve('src/.hidden.ts')]);
    expect(result.ignored).toBe(1);
  });

  it('matches multiple watched extensions', () => {
    const result = match(['src/main.ts', 'src/config.json', 'src/readme.md'], ['**/src/**'], 'ts,json');

    expect(result.result).toEqual([path.resolve('src/main.ts'), path.resolve('src/config.json')]);
  });
});
