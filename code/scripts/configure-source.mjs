import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const origin = new URL(process.argv[2]);
if (origin.protocol !== 'https:' || origin.username || origin.password ||
    origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('Provide an HTTPS origin, for example https://tasks.example.com');
}
const target = fileURLToPath(new URL('../src/functions/external-system/source-config.json', import.meta.url));
fs.writeFileSync(target, JSON.stringify({ origin: origin.origin }, null, 2) + '\n');
console.log(`Connector source set to ${origin.origin}. Rebuild before packaging.`);
