import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const origin = new URL(process.argv[2]);
if (origin.protocol !== 'https:' || origin.username || origin.password ||
    origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('Provide an HTTPS origin, for example https://tasks.example.com');
}
const manifestPath = fileURLToPath(new URL('../../manifest.yaml', import.meta.url));
const manifest = fs.readFileSync(manifestPath, 'utf8');
if (!/^ {8}url: .+$/m.test(manifest)) throw new Error('Token verification URL is missing');
const target = fileURLToPath(new URL('../src/functions/external-system/source-config.json', import.meta.url));
fs.writeFileSync(target, JSON.stringify({ origin: origin.origin }, null, 2) + '\n');
fs.writeFileSync(manifestPath, manifest.replace(/^( {6,8})url: .+$/gm, (_, indent) => `${indent}url: ${origin.origin}/projects`));
console.log(`Connector source set to ${origin.origin}. Rebuild before packaging.`);
