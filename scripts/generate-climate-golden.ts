/**
 * Regenerates test/fixtures/climate-golden.json: the climate fields the parser
 * produced BEFORE v0.10 (base commit 51679e2) for every thermostat in
 * deviceid-climate.json. The golden test compares the current parser to it.
 *
 * Usage (in a scratch dir outside the repo, so old and new code never mix):
 *   mkdir /tmp/base && git archive 51679e2 lib tsconfig.json | tar -x -C /tmp/base
 *   mkdir /tmp/base/scripts && cp scripts/generate-climate-golden.ts /tmp/base/scripts/
 *   ln -s "$PWD/node_modules" /tmp/base/node_modules
 *   (cd /tmp/base && npx tsc --outDir out --rootDir . --skipLibCheck --esModuleInterop \
 *     --target es2020 --module commonjs scripts/generate-climate-golden.ts)
 *   node /tmp/base/out/scripts/generate-climate-golden.js test/fixtures/deviceid-climate.json \
 *     > test/fixtures/climate-golden.json
 * Do not regenerate from the current code: that would make the test vacuous.
 */
import * as fs from 'fs';
import { IT600Gateway } from '../lib/salus-api';

const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as { id: unknown[] };
const gateway = new IT600Gateway('0123456789ABCDEF', '10.0.0.9');
const internals = gateway as unknown as {
  refreshClimateDevices(devices: unknown[]): void;
  climateDevices: Map<string, unknown>;
};
internals.refreshClimateDevices(fixture.id);
console.log(JSON.stringify([...internals.climateDevices.values()], null, 2));
