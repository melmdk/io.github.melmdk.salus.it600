import { test } from 'node:test';
import type { TestContext } from 'node:test';
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
  const gateway = new IT600Gateway(EUID, '10.0.0.9', { transport, protocol: 'aes-256-cbc' });
  // The climate map is private; read it through the same cast the parser tests would need.
  const climateCount = () => (gateway as unknown as { climateDevices: Map<string, unknown> }).climateDevices.size;
  return { transport, gateway, climateCount };
}

/**
 * Silence the one fallback notice the gateway logs (keeps test output clean)
 * and return a check that it was logged exactly once, with `reason`.
 */
function expectFallbackLog(t: TestContext, reason: RegExp): () => void {
  const log = t.mock.method(console, 'log', () => undefined);
  return () => {
    assert.equal(log.mock.callCount(), 1);
    const message = String(log.mock.calls[0].arguments[0]);
    assert.match(message, /per device type from now on/);
    assert.match(message, reason);
  };
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

test('an answer with a different Endpoint counts as left out', async (t) => {
  const checkLog = expectFallbackLog(t, /left out 13 of 13/);
  const shifted = JSON.parse(JSON.stringify(detailPool[0])) as typeof detailPool[0];
  for (const entry of shifted.id ?? []) entry.data.Endpoint = 99;
  const { gateway, climateCount } = setup({ detailPool: [shifted] });
  gateway.setCombinedDetailRequests(true);
  await gateway.pollStatus();
  assert.equal(gateway.combinedDetailRequests, false);
  assert.equal(gateway.lastPollUsedCombined, false);
  assert.ok(climateCount() > 0);
  checkLog();
});

for (const [name, outcome] of [['rejection', 'reject'], ['when devices are left out', 'omit']] as const) {
  test(`combined falls back on ${name}`, async (t) => {
    const checkLog = expectFallbackLog(t, outcome === 'reject' ? /rejected/ : /left out 1 of 13/);
    // First deviceid request is the combined one; the per-type fallback is answered.
    const { transport, gateway, climateCount } = setup({
      onDetails: (_ids, call) => (call === 0 ? outcome : 'ok'),
    });
    gateway.setCombinedDetailRequests(true);
    await gateway.pollStatus();
    assert.equal(gateway.combinedDetailRequests, false);
    assert.equal(gateway.lastPollUsedCombined, false);
    assert.equal(transport.detailRequests.length, 3, 'combined request, then per-type for climate and wiring centres');
    assert.equal(climateCount(), EXPECTED_CLIMATE);
    checkLog();
  });
}

test('combined falls back after 3 drops', async (t) => {
  const checkLog = expectFallbackLog(t, /repeated connection failures/);
  // A dropped poll is 3 calls: the combined request, then one per-type request per family.
  const { transport, gateway, climateCount } = setup({
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
  checkLog();
});

test('combined falls back after 3 unreadable answers', async (t) => {
  const checkLog = expectFallbackLog(t, /repeated unreadable answers/);
  // A truncated answer cannot be decrypted or parsed; like a drop it costs the
  // combined request plus one per-type request per family.
  const { transport, gateway, climateCount } = setup({
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
  checkLog();
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
  const climateIds = new Set((gateway as unknown as { climateDevices: Map<string, unknown> }).climateDevices.keys());
  assert.ok(centres.every((c) => !climateIds.has(c.uniqueId)));
});
