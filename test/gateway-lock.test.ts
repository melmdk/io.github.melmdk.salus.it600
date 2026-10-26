import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IT600ConnectionError, IT600Gateway } from '../lib/salus-api';
import type { Transport } from '../lib/transport';
import { loadFixture } from './helpers/fixtures';
import { fakeGateway } from './helpers/fake-gateway';

const EUID = '0123456789ABCDEF';
const fixtures = { readall: loadFixture('readall') };
const detailPool = [loadFixture('deviceid-combined')];

/** Requests in flight across every wrapped transport, and the most seen at once. */
function concurrencyMeter() {
  const meter = { inFlight: 0, max: 0, requests: 0 };
  const wrap = (inner: Transport): Transport => {
    const transport = (async (path: string, body: Buffer) => {
      meter.inFlight += 1;
      meter.requests += 1;
      meter.max = Math.max(meter.max, meter.inFlight);
      try {
        // Hold the request open long enough for another instance to try to overlap.
        await new Promise((resolve) => setTimeout(resolve, 2));
        return await inner(path, body);
      } finally {
        meter.inFlight -= 1;
      }
    }) as Transport;
    const { probeRoot } = inner;
    if (probeRoot) {
      transport.probeRoot = async () => {
        meter.inFlight += 1;
        meter.max = Math.max(meter.max, meter.inFlight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 2));
          await probeRoot();
        } finally {
          meter.inFlight -= 1;
        }
      };
    }
    return transport;
  };
  return { meter, wrap };
}

test('gateway instances never have overlapping requests', async () => {
  // The app keeps the old instance polling and writing while a new one connects
  // (repair, settings save); there is only one physical gateway.
  const { meter, wrap } = concurrencyMeter();
  const make = (protocol?: 'aes-256-cbc') => new IT600Gateway(EUID, '10.0.0.9', {
    protocol,
    transport: wrap(fakeGateway({ protocol: 'aes-256-cbc', euid: EUID, fixtures, detailPool })),
  });
  const current = make('aes-256-cbc');
  await current.connect();
  meter.max = 0;

  const replacement = make();
  await Promise.all([
    current.pollStatus(),
    current.pollStatus(),
    replacement.connect().then(() => replacement.pollStatus()),
  ]);

  assert.ok(meter.requests > 4, `expected several requests, saw ${meter.requests}`);
  assert.equal(meter.max, 1);
});

test('the root probe of a failing connect does not overlap another instance', async () => {
  const { meter, wrap } = concurrencyMeter();
  const current = new IT600Gateway(EUID, '10.0.0.9', {
    protocol: 'aes-256-cbc',
    transport: wrap(fakeGateway({ protocol: 'aes-256-cbc', euid: EUID, fixtures, detailPool })),
  });
  await current.connect();
  meter.max = 0;

  // A repair typed a dead IP: the replacement fails its request, then probes the root.
  const replacement = new IT600Gateway(EUID, '10.0.0.3', {
    transport: wrap(fakeGateway({ protocol: 'aes-256-cbc', euid: EUID, fixtures, unreachable: true })),
  });
  const results = await Promise.allSettled([current.pollStatus(), replacement.connect(), current.pollStatus()]);

  assert.equal(results[0].status, 'fulfilled');
  assert.ok(results[1].status === 'rejected' && results[1].reason instanceof IT600ConnectionError);
  assert.equal(meter.max, 1);
});
