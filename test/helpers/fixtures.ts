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

/** Load a sanitised gateway response captured from real hardware. */
export function loadFixture(name: FixtureName): ApiResponse {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8')) as ApiResponse;
}
