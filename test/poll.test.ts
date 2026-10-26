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
  const gateway = new IT600Gateway(EUID, '10.0.0.9', { transport, protocol: 'aes-256-cbc' });
  // The climate map is private; read it through the same cast the parser tests would need.
  const climateCount = () => (gateway as unknown as { climateDevices: Map<string, unknown> }).climateDevices.size;
  return { transport, gateway, climateCount };
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
  assert.deepEqual(transport.attrs, ['readall', 'deviceid']);
  assert.equal(transport.detailRequests[0].length, 11);
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
  const { gateway, climateCount } = setup({ detailPool: [shifted] });
  gateway.setCombinedDetailRequests(true);
  await gateway.pollStatus();
  assert.equal(gateway.combinedDetailRequests, false);
  assert.equal(gateway.lastPollUsedCombined, false);
  assert.ok(climateCount() > 0);
});

for (const [name, outcome] of [['rejection', 'reject'], ['when devices are left out', 'omit']] as const) {
  test(`combined falls back on ${name}`, async () => {
    // First deviceid request is the combined one; the per-type fallback is answered.
    const { transport, gateway, climateCount } = setup({
      onDetails: (_ids, call) => (call === 0 ? outcome : 'ok'),
    });
    gateway.setCombinedDetailRequests(true);
    await gateway.pollStatus();
    assert.equal(gateway.combinedDetailRequests, false);
    assert.equal(gateway.lastPollUsedCombined, false);
    assert.equal(transport.detailRequests.length, 2, 'combined request, then per-type');
    assert.equal(climateCount(), EXPECTED_CLIMATE);
  });
}

test('combined falls back after 3 drops', async () => {
  // Combined requests are the even calls; each poll's per-type fallback is the odd one.
  const { transport, gateway, climateCount } = setup({
    onDetails: (_ids, call) => (call < 6 && call % 2 === 0 ? 'drop' : 'ok'),
  });
  gateway.setCombinedDetailRequests(true);
  for (let poll = 1; poll <= 3; poll += 1) {
    assert.equal(gateway.combinedDetailRequests, true, `still on before poll ${poll}`);
    await gateway.pollStatus();
    assert.equal(climateCount(), EXPECTED_CLIMATE);
  }
  assert.equal(gateway.combinedDetailRequests, false);
  assert.equal(transport.detailRequests.length, 6);

  await gateway.pollStatus();
  assert.equal(transport.detailRequests.length, 7, 'per-type only from now on');
});

test('a successful combined request resets the drop counter', async () => {
  const drops = new Set([0, 2, 5]);
  const { gateway } = setup({ onDetails: (_ids, call) => (drops.has(call) ? 'drop' : 'ok') });
  gateway.setCombinedDetailRequests(true);
  await gateway.pollStatus(); // call 0 dropped, call 1 per-type
  await gateway.pollStatus(); // call 2 dropped, call 3 per-type
  await gateway.pollStatus(); // call 4 combined ok
  await gateway.pollStatus(); // call 5 dropped, call 6 per-type
  assert.equal(gateway.combinedDetailRequests, true);
});
