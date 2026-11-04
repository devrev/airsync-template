# Dependency review — 2026-11-04

This change consolidates the pending TypeScript SDK and jiti updates, pins AirSync SDK 2.1.0-beta.2, updates Turndown to 7.2.5, and refreshes dependencies within their existing declared ranges. It preserves the body-parser 1.20.9, handlebars 4.7.10, qs 6.16.2, and follow-redirects 1.16.2 security patches already selected by this branch or main.

A scoped override selects minimatch 11.0.1 for nodemon. Its CommonJS named `minimatch` export supports nodemon's caller; regression tests exercise watched TypeScript files, dotfiles, ignores, and multiple extensions. Older minimatch consumers retain their versions because v11 replaces the matching engine and is incompatible with legacy callable exports and internal APIs. A global override would require separate caller migrations.

Fresh Snyk scans against main at 0369f4a and this change include development dependencies. Production dependencies have zero reported vulnerabilities. With development dependencies included, seven unique advisories remain (two high, five medium), across 23 paths versus 24 on main. The nodemon path for SNYK-JS-MINIMATCH-22111072 is removed; the advisory remains through other tooling paths.

| Remaining advisory | Package | Reason deferred |
| --- | --- | --- |
| [SNYK-JS-BRACES-19963945](https://security.snyk.io/vuln/SNYK-JS-BRACES-19963945) | braces 3.0.3 | No published patch; used by watcher and test tooling. |
| [SNYK-JS-DEEPMERGE-19964053](https://security.snyk.io/vuln/SNYK-JS-DEEPMERGE-19964053) | deepmerge 4.3.1 | No published patch; Jest configuration dependency. |
| [SNYK-JS-INFLIGHT-6095116](https://security.snyk.io/vuln/SNYK-JS-INFLIGHT-6095116) | inflight 1.0.6 | No published patch; removing it requires migrating the Jest/coverage toolchain. |
| [SNYK-JS-MINIMATCH-22111072](https://security.snyk.io/vuln/SNYK-JS-MINIMATCH-22111072) | minimatch 3, 8, 9, 10 | Patched in 11.0.1; remaining consumers need compatible parent upgrades or migrations. |
| [SNYK-JS-URIJS-19963961](https://security.snyk.io/vuln/SNYK-JS-URIJS-19963961) | uri-js 4.4.1 | No published patch; ESLint/Ajv dependency. |
| [SNYK-JS-URIJS-19963963](https://security.snyk.io/vuln/SNYK-JS-URIJS-19963963) | uri-js 4.4.1 | No published patch; ESLint/Ajv dependency. |
| [SNYK-JS-URIJS-20341609](https://security.snyk.io/vuln/SNYK-JS-URIJS-20341609) | uri-js 4.4.1 | No published patch; ESLint/Ajv dependency. |

Snyk Code returns three existing findings with accepted suppressions: local HTTP in `test/runner.test.ts`, fixture paths in `src/main.ts`, and local server responses in `test/runner.ts`. There are no active Code findings. Existing policies and accepted decisions were preserved. Hosted project inventory pagination failed after 2,100 entries, so these results rely on fresh local scans rather than a complete hosted inventory.

Validation: reproducible npm install, TypeScript build, lint, all 11 tests, and local SDK extraction/loading and attachment worker checks pass. npm audit reports zero high/critical findings and 37 low/moderate findings. The import fixes were also verified on DEV before this dependency refresh: 15 issues, 10 users, two linked attachments, and no warnings. The refreshed dependencies have local validation; that exact dependency tree has not been redeployed to DEV.
