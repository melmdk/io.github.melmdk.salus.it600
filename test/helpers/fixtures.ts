import * as fs from 'fs';
import * as path from 'path';
import type { ApiResponse } from '../../lib/device-types';

export type FixtureName =
  | 'readall'
  | 'deviceid-combined'
  | 'deviceid-climate'
  | 'deviceid-binary'
  | 'deviceid-temp'
  | 'deviceid-switch'
  | 'deviceid-cover'
  | 'deviceid-wiring-centre';

// Compiled to .test-build/test/helpers, fixtures live in the source tree.
const FIXTURE_DIR = path.resolve(__dirname, '../../../test/fixtures');

/**
 * Load a sanitised gateway response captured from real hardware. Families the
 * capture gateway doesn't have (binary, temp, switch, cover) have no fixture;
 * asking for one throws an error that names it and lists the available ones.
 */
export function loadFixture(name: FixtureName): ApiResponse {
  const file = path.join(FIXTURE_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    const available = fs.readdirSync(FIXTURE_DIR)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => entry.slice(0, -'.json'.length))
      .sort();
    throw new Error(`No fixture "${name}" in test/fixtures (the capture gateway has none); available: ${available.join(', ')}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ApiResponse;
}
