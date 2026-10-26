import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { parseClimateDevice } from '../lib/parsers/climate';
import type { ApiDeviceStatus, ClimateDevice } from '../lib/device-types';
import { loadFixture } from './helpers/fixtures';

// Climate output of the pre-v0.10 parser (commit ae63bd2); see scripts/generate-climate-golden.ts.
const golden = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/climate-golden.json'), 'utf8'),
) as Array<Record<string, unknown>>;
const entries = loadFixture('deviceid-climate').id ?? [];

test('golden snapshot covers every fixture thermostat', () => {
  assert.equal(golden.length, 11);
  assert.equal(entries.length, 11);
});

test('climate parse is unchanged apart from rssi, lqi, problems and the Away preset entry', () => {
  for (const entry of entries) {
    const expected = golden.find((g) => g.uniqueId === entry.data.UniID);
    assert.ok(expected, `golden entry for ${entry.data.UniID}`);
    const actual = parseClimateDevice(entry) as ClimateDevice;
    const { rssi, lqi, problems, ...rest } = actual;
    void rssi; void lqi; void problems;
    rest.presetModes = rest.presetModes.filter((p) => p !== 'Away');
    assert.deepEqual(rest, expected, `device ${actual.name}`);
  }
});

test('a thermostat without DeviceL keeps a null model and humidity even with sBasicS', () => {
  const entry = JSON.parse(JSON.stringify(entries[0])) as ApiDeviceStatus;
  delete entry.DeviceL;
  entry.sBasicS = { ...entry.sBasicS, ModelIdentifier: 'SQ610RFNH' };
  const device = parseClimateDevice(entry);
  assert.equal(device?.model, null);
  assert.equal(device?.currentHumidity, null);
});
