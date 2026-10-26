/**
 * Live, read-only check of connection detection and error mapping.
 * Usage: npx tsc -p tsconfig.test.json && node .test-build/scripts/probe-errors.js
 * Reads test-config.json ({ host, euid }); prints only protocol names and
 * error messages, never the EUID.
 */
import * as fs from 'fs';
import * as path from 'path';
import { IT600Gateway } from '../lib/salus-api';

const root = path.resolve(__dirname, '../..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'test-config.json'), 'utf8')) as { host: string; euid: string };

async function probe(label: string, host: string, euid: string): Promise<void> {
  try {
    const { protocol } = await new IT600Gateway(euid, host).connect();
    console.log(`${label}: ${protocol}`);
  } catch (err) {
    console.log(`${label}: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  await probe('real config', config.host, config.euid);
  await probe('wrong euid', config.host, '0000000000000001');
  await probe('unreachable host', '10.10.20.3', config.euid);
}

void main();
