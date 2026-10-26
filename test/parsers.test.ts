import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IT600CommandError, IT600Gateway } from '../lib/salus-api';
import { parseClimateDevice } from '../lib/parsers/climate';
import { parseWiringCentre } from '../lib/parsers/wiring-centre';
import { diffProblems } from '../lib/parsers/common';
import type { ApiDeviceStatus } from '../lib/device-types';
import { loadFixture } from './helpers/fixtures';
import { fakeGateway } from './helpers/fake-gateway';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const climateEntries = loadFixture('deviceid-climate').id ?? [];
const wcEntries = loadFixture('deviceid-wiring-centre').id ?? [];
const climate = climateEntries.map((d) => parseClimateDevice(d)).filter((d) => d !== null);
const sq610 = (): ApiDeviceStatus => clone(climateEntries.find((d) => d.sIT600TH) as ApiDeviceStatus);

test('parses 11 thermostats including Mikkel', () => {
  assert.equal(climate.length, 11);
  const names = climate.map((d) => d?.name);
  assert.ok(names.includes('Mikkel'));
  assert.ok(names.includes('Bad Børn'));
  for (const name of ['Mikkel', 'Bad Børn']) {
    const device = climate.find((d) => d?.name === name);
    assert.equal(device?.maxTemp, 35);
    assert.equal(device?.minTemp, 5);
  }
});

test('sq610 presets unchanged except away', () => {
  const expected: Array<[number, string]> = [
    [2, 'Permanent Hold'], [7, 'Off'], [0, 'Follow Schedule'], [1, 'Follow Schedule'], [6, 'Away'],
  ];
  for (const [holdType, preset] of expected) {
    const entry = sq610();
    (entry.sIT600TH as { HoldType: number }).HoldType = holdType;
    const device = parseClimateDevice(entry);
    assert.equal(device?.presetMode, preset, `HoldType ${holdType}`);
    assert.ok(device?.presetModes.includes('Away'));
  }
});

async function writeFor(preset: 'Away' | 'Temporary Hold') {
  const euid = '0123456789ABCDEF';
  const transport = fakeGateway({
    protocol: 'aes-256-cbc', euid, fixtures: { readall: loadFixture('readall') }, detailPool: [loadFixture('deviceid-combined')],
  });
  const gateway = new IT600Gateway(euid, '10.0.0.9', { transport, protocol: 'aes-256-cbc' });
  await gateway.pollStatus();
  const target = [...gateway.getClimateDevices().values()].find((d) => d.name === 'Gæsteværelse');
  assert.ok(target);
  await gateway.setClimatePreset(target.uniqueId, preset);
  assert.equal(transport.writes.length, 1);
  const { data, ...rest } = transport.writes[0].id?.[0] ?? {};
  assert.equal((data as { UniID: string }).UniID, target.uniqueId);
  return rest;
}

test('away writes HoldType 6', async () => {
  assert.deepEqual(await writeFor('Away'), { sIT600TH: { SetHoldType: 6 } });
});

test('temporary hold on an SQ610 still writes HoldType 0', async () => {
  assert.deepEqual(await writeFor('Temporary Hold'), { sIT600TH: { SetHoldType: 0 } });
});

async function fc600Gateway() {
  const euid = '0123456789ABCDEF';
  // No FC600 in the fixtures: relabel Gæsteværelse, the write path keys on the model.
  const pool = clone(loadFixture('deviceid-combined'));
  const entry = (pool.id ?? []).find((e) => (e.sZDO?.DeviceName ?? '').includes('Gæsteværelse'));
  assert.ok(entry?.DeviceL);
  entry.DeviceL.ModelIdentifier_i = 'FC600';
  const transport = fakeGateway({
    protocol: 'aes-256-cbc', euid, fixtures: { readall: loadFixture('readall') }, detailPool: [pool],
  });
  const gateway = new IT600Gateway(euid, '10.0.0.9', { transport, protocol: 'aes-256-cbc' });
  await gateway.pollStatus();
  const target = [...gateway.getClimateDevices().values()].find((d) => d.name === 'Gæsteværelse');
  assert.equal(target?.model, 'FC600');
  return { transport, gateway, id: target.uniqueId };
}

test('away is rejected on an FC600 and nothing is written', async () => {
  const { transport, gateway, id } = await fc600Gateway();
  await assert.rejects(gateway.setClimatePreset(id, 'Away'), (err: Error) => {
    assert.ok(err instanceof IT600CommandError);
    assert.equal(err.message, 'Away is not supported on this thermostat');
    return true;
  });
  assert.equal(transport.writes.length, 0);
  await gateway.setClimatePreset(id, 'Eco');
  assert.deepEqual(transport.writes[0].id?.[0].sComm, { SetHoldType: 10 });
});

test('thermostat problems from error flags', () => {
  assert.deepEqual(parseClimateDevice(sq610())?.problems, []);
  const entry = sq610();
  (entry.sIT600TH as Record<string, number>).Error32 = 1;
  assert.deepEqual(parseClimateDevice(entry)?.problems, ['Low battery']);
});

test('signal keeps last value', () => {
  const previous = { ...(parseClimateDevice(sq610()) as NonNullable<ReturnType<typeof parseClimateDevice>>), rssi: -70, lqi: 200 };
  const entry = sq610();
  delete entry.sIT600I;
  const device = parseClimateDevice(entry, previous);
  assert.equal(device?.rssi, -70);
  assert.equal(device?.lqi, 200);
  entry.sIT600I = { LastMessageRSSI_d: -55, LastMessageLQI_d: 250 };
  assert.equal(parseClimateDevice(entry, previous)?.rssi, -55);
  assert.equal(parseClimateDevice(sq610())?.rssi, null, 'no sIT600I and no previous');
});

test('parses 2 wiring centres', () => {
  const centres = wcEntries.map((d) => parseWiringCentre(d)).filter((d) => d !== null);
  assert.deepEqual(centres.map((d) => d?.name).sort(), ['Depotrum', 'Kældertrappe']);
  for (const centre of centres) {
    assert.equal(centre?.connected, true);
    assert.deepEqual(centre?.problems, []);
    assert.equal(typeof centre?.rssi, 'number');
  }
  const entry = clone(wcEntries[0]);
  (entry.sIT600WC as Record<string, string>).ErrorCodeWC_d = '0010';
  assert.deepEqual(parseWiringCentre(entry)?.problems, ['Wiring centre error code 0010']);
  (entry.sIT600WC as Record<string, string | number>).ErrorCodeWC_d = '0000';
  (entry.sIT600WC as Record<string, number>).Error19 = 1;
  assert.deepEqual(parseWiringCentre(entry)?.problems, ['Lost link with Gateway']);
});

test('offline thermostat parses as unavailable', () => {
  const entry = sq610();
  entry.sZDOInfo = { OnlineStatus_i: 0 };
  const device = parseClimateDevice(entry);
  assert.ok(device);
  assert.equal(device.available, false);
});

test('diffProblems returns only new problems', () => {
  assert.deepEqual(diffProblems(['Low battery'], ['Low battery', 'Lost link with Gateway']), ['Lost link with Gateway']);
  assert.deepEqual(diffProblems([], []), []);
});
