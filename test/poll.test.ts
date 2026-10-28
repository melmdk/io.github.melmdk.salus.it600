import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IT600Gateway } from '../lib/salus-api';
import { loadFixture } from './helpers/fixtures';
import { fakeGateway, FakeGatewayOptions } from './helpers/fake-gateway';

const EUID = '0123456789ABCDEF';
const readall = loadFixture('readall');
const climate = loadFixture('deviceid-climate');
// Detail entries of every family the fixtures cover (wiring centres included).
const detailPool = [loadFixture('deviceid-combined')];

function setup(fake: Partial<FakeGatewayOptions> = {}) {
  const transport = fakeGateway({
    protocol: 'aes-256-cbc',
    euid: EUID,
    fixtures: { readall },
    detailPool,
    ...fake,
  });
  const logs: string[] = [];
  const errors: string[] = [];
  const logger = {
    log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
  };
  const gateway = new IT600Gateway(EUID, '10.0.0.9', { transport, protocol: 'aes-256-cbc', logger });
  const climateCount = () => gateway.getClimateDevices().size;
  /** The one fallback notice was logged exactly once, with `reason`. */
  const checkFallbackLog = (reason: RegExp): void => {
    assert.equal(logs.length, 1, logs.join('\n'));
    assert.match(logs[0], /per device type from now on/);
    assert.match(logs[0], reason);
  };
  return { transport, gateway, climateCount, logs, errors, checkFallbackLog };
}

// The fixture answers 11 climate entries and the parser yields all 11 (the brief
// expected 10; every entry is online and carries sIT600TH).
const EXPECTED_CLIMATE = 11;

test('fixture sanity: climate fixture answers 11 entries', () => {
  assert.equal(climate.id?.length, 11);
});

test('per-type by default', async () => {
  const { transport, gateway, climateCount } = setup();
  assert.equal(gateway.combinedDetailRequests, false);
  await gateway.pollStatus();
  // One deviceid request per family: climate, then wiring centres.
  assert.deepEqual(transport.attrs, ['readall', 'deviceid', 'deviceid']);
  assert.equal(transport.detailRequests[0].length, 11);
  assert.equal(transport.detailRequests[1].length, 2);
  assert.equal(climateCount(), EXPECTED_CLIMATE);
});

test('combined when enabled', async () => {
  const { transport, gateway, climateCount } = setup();
  gateway.setCombinedDetailRequests(true);
  assert.equal(gateway.combinedDetailRequests, true);
  await gateway.pollStatus();
  assert.deepEqual(transport.attrs, ['readall', 'deviceid']);
  assert.equal(climateCount(), EXPECTED_CLIMATE);
  assert.equal(gateway.combinedDetailRequests, true);
  assert.equal(gateway.lastPollUsedCombined, true);
});

test('lastPollUsedCombined is false for a per-type poll', async () => {
  const { gateway } = setup();
  await gateway.pollStatus();
  assert.equal(gateway.lastPollUsedCombined, false);
});

test('a single dropped combined request falls back for that poll only', async () => {
  const { gateway, climateCount } = setup({ onDetails: (_ids, call) => (call === 0 ? 'drop' : 'ok') });
  gateway.setCombinedDetailRequests(true);
  await gateway.pollStatus();
  assert.equal(gateway.combinedDetailRequests, true);
  assert.equal(gateway.lastPollUsedCombined, false);
  assert.equal(climateCount(), EXPECTED_CLIMATE);
  await gateway.pollStatus();
  assert.equal(gateway.lastPollUsedCombined, true);
});

test('an answer with a different Endpoint counts as left out', async () => {
  const shifted = JSON.parse(JSON.stringify(detailPool[0])) as typeof detailPool[0];
  for (const entry of shifted.id ?? []) entry.data.Endpoint = 99;
  const { gateway, climateCount, checkFallbackLog } = setup({ detailPool: [shifted] });
  gateway.setCombinedDetailRequests(true);
  await gateway.pollStatus();
  assert.equal(gateway.combinedDetailRequests, false);
  assert.equal(gateway.lastPollUsedCombined, false);
  // The per-type fallback is answered from the same shifted pool, so every thermostat still arrives.
  assert.equal(climateCount(), EXPECTED_CLIMATE);
  checkFallbackLog(/left out 13 of 13/);
});

for (const [name, outcome] of [['rejection', 'reject'], ['when devices are left out', 'omit']] as const) {
  test(`combined falls back on ${name}`, async () => {
    // First deviceid request is the combined one; the per-type fallback is answered.
    const { transport, gateway, climateCount, checkFallbackLog } = setup({
      onDetails: (_ids, call) => (call === 0 ? outcome : 'ok'),
    });
    gateway.setCombinedDetailRequests(true);
    await gateway.pollStatus();
    assert.equal(gateway.combinedDetailRequests, false);
    assert.equal(gateway.lastPollUsedCombined, false);
    assert.equal(transport.detailRequests.length, 3, 'combined request, then per-type for climate and wiring centres');
    assert.equal(climateCount(), EXPECTED_CLIMATE);
    checkFallbackLog(outcome === 'reject' ? /rejected/ : /left out 1 of 13/);
  });
}

test('combined falls back after 3 drops', async () => {
  // A dropped poll is 3 calls: the combined request, then one per-type request per family.
  const { transport, gateway, climateCount, checkFallbackLog } = setup({
    onDetails: (_ids, call) => (call < 9 && call % 3 === 0 ? 'drop' : 'ok'),
  });
  gateway.setCombinedDetailRequests(true);
  for (let poll = 1; poll <= 3; poll += 1) {
    assert.equal(gateway.combinedDetailRequests, true, `still on before poll ${poll}`);
    await gateway.pollStatus();
    assert.equal(climateCount(), EXPECTED_CLIMATE);
  }
  assert.equal(gateway.combinedDetailRequests, false);
  assert.equal(transport.detailRequests.length, 9);

  await gateway.pollStatus();
  assert.equal(transport.detailRequests.length, 11, 'per-type only from now on');
  checkFallbackLog(/repeated connection failures/);
});

test('combined falls back after 3 unreadable answers', async () => {
  // A truncated answer cannot be decrypted or parsed; like a drop it costs the
  // combined request plus one per-type request per family.
  const { transport, gateway, climateCount, checkFallbackLog } = setup({
    onDetails: (_ids, call) => (call < 9 && call % 3 === 0 ? 'truncate' : 'ok'),
  });
  gateway.setCombinedDetailRequests(true);
  for (let poll = 1; poll <= 3; poll += 1) {
    assert.equal(gateway.combinedDetailRequests, true, `still on before poll ${poll}`);
    await gateway.pollStatus();
    assert.equal(gateway.lastPollUsedCombined, false);
    assert.equal(climateCount(), EXPECTED_CLIMATE);
  }
  assert.equal(gateway.combinedDetailRequests, false);
  assert.equal(transport.detailRequests.length, 9);

  await gateway.pollStatus();
  assert.equal(transport.detailRequests.length, 11, 'per-type only from now on');
  checkFallbackLog(/repeated unreadable answers/);
});

test('a combined answer whose id is not a list counts as unreadable', async () => {
  const { gateway, climateCount, checkFallbackLog } = setup({
    onDetails: (ids) => (ids.length === 13 ? 'malformed' : 'ok'),
  });
  gateway.setCombinedDetailRequests(true);
  for (let poll = 1; poll <= 3; poll += 1) {
    assert.equal(gateway.combinedDetailRequests, true, `still on before poll ${poll}`);
    // The poll itself succeeds over per-type requests.
    await gateway.pollStatus();
    assert.equal(gateway.lastPollUsedCombined, false);
    assert.equal(climateCount(), EXPECTED_CLIMATE);
  }
  assert.equal(gateway.combinedDetailRequests, false);
  checkFallbackLog(/repeated unreadable answers/);
});

test('a successful combined request resets the drop counter', async () => {
  const drops = new Set([0, 3, 7]);
  const { gateway } = setup({ onDetails: (_ids, call) => (drops.has(call) ? 'drop' : 'ok') });
  gateway.setCombinedDetailRequests(true);
  await gateway.pollStatus(); // call 0 dropped, calls 1-2 per-type
  await gateway.pollStatus(); // call 3 dropped, calls 4-5 per-type
  await gateway.pollStatus(); // call 6 combined ok
  await gateway.pollStatus(); // call 7 dropped, calls 8-9 per-type
  assert.equal(gateway.combinedDetailRequests, true);
});

test('one combined request covers climate and wiring centres, each refreshed from its slice', async () => {
  const { transport, gateway, climateCount } = setup();
  gateway.setCombinedDetailRequests(true);
  await gateway.pollStatus();
  assert.deepEqual(transport.attrs, ['readall', 'deviceid']);
  assert.equal(transport.detailRequests[0].length, 13, '11 thermostats + 2 wiring centres in one request');
  assert.equal(gateway.lastPollUsedCombined, true);
  assert.equal(climateCount(), EXPECTED_CLIMATE);
  const centres = [...gateway.getWiringCentreDevices().values()];
  assert.deepEqual(centres.map((c) => c.name).sort(), ['Depotrum', 'Kældertrappe']);
  assert.ok(gateway.getWiringCentreDevice(centres[0].uniqueId));
  // Neither family picked up the other's devices.
  const climateIds = new Set(gateway.getClimateDevices().keys());
  assert.ok(centres.every((c) => !climateIds.has(c.uniqueId)));
});

test('a failed per-type fetch for unkeyed devices keeps the combined details', async () => {
  // An extra thermostat without a UniID cannot be in the combined request; its
  // per-type request is rejected.
  const unkeyed = JSON.parse(JSON.stringify(readall.id?.find((d) => d.sIT600TH))) as NonNullable<typeof readall.id>[number];
  unkeyed.data = { Endpoint: unkeyed.data.Endpoint } as typeof unkeyed.data;
  const withUnkeyed = { ...readall, id: [...(readall.id ?? []), unkeyed] };
  const { transport, gateway, climateCount, errors } = setup({
    fixtures: { readall: withUnkeyed },
    onDetails: (ids) => (ids.length === 1 && ids[0] === '' ? 'reject' : 'ok'),
  });
  gateway.setCombinedDetailRequests(true);
  await gateway.pollStatus();
  assert.equal(transport.detailRequests.length, 2, 'the combined request, then the unkeyed one');
  assert.equal(climateCount(), EXPECTED_CLIMATE, 'the keyed thermostats come from the combined answer');
  assert.equal(gateway.lastPollUsedCombined, true);
  assert.equal(gateway.combinedDetailRequests, true, 'an unkeyed failure is not a combined failure');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /without a UniID/);
});

test('gateway notices go to its logger, the fallback notice once per combined-requests opt-in', async (t) => {
  const consoleLog = t.mock.method(console, 'log', () => undefined);
  const consoleError = t.mock.method(console, 'error', () => undefined);
  const { gateway, logs, checkFallbackLog } = setup({ onDetails: (ids) => (ids.length === 13 ? 'reject' : 'ok') });
  gateway.setCombinedDetailRequests(true);
  await gateway.pollStatus();
  checkFallbackLog(/rejected/);

  // Still off: a further poll does not log the notice again.
  await gateway.pollStatus();
  assert.equal(logs.length, 1);

  // Switched on again (settings page) and rejected again: that fallback is logged too.
  gateway.setCombinedDetailRequests(true);
  await gateway.pollStatus();
  assert.equal(gateway.combinedDetailRequests, false);
  assert.equal(logs.length, 2, logs.join('\n'));
  assert.match(logs[1], /per device type from now on/);
  assert.match(logs[1], /rejected/);
  assert.equal(consoleLog.mock.callCount(), 0);
  assert.equal(consoleError.mock.callCount(), 0);
});

test('detail entries without a UniID are skipped, the rest are refreshed', async () => {
  const pool = JSON.parse(JSON.stringify(detailPool[0])) as typeof detailPool[0];
  const stray = JSON.parse(JSON.stringify(pool.id?.find((d) => d.sIT600TH))) as NonNullable<typeof pool.id>[number];
  stray.data = { Endpoint: stray.data.Endpoint } as typeof stray.data;
  const deviceid = { status: 'success', id: [...(pool.id ?? []), stray] } as typeof pool;
  // Per type, every deviceid request is answered with this list, stray entry included.
  const { gateway, climateCount } = setup({ detailPool: undefined, fixtures: { readall, deviceid } });
  await gateway.pollStatus();
  assert.equal(climateCount(), EXPECTED_CLIMATE);
  assert.ok([...gateway.getClimateDevices().keys()].every((id) => /^00000000000000[0-9a-f]{2}$/.test(id)));
});
