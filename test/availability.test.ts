import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AvailabilityTracker } from '../lib/availability';
import type { AvailabilityTarget } from '../lib/availability';

test('the first update is always applied', () => {
  assert.equal(new AvailabilityTracker().changed(null), true);
  assert.equal(new AvailabilityTracker().changed('Device offline'), true);
});

test('repeating the same availability is not applied again', () => {
  const tracker = new AvailabilityTracker();
  const applied = [null, null, 'Device offline', 'Device offline', 'Device offline', null, null]
    .map((reason) => tracker.changed(reason));
  assert.deepEqual(applied, [true, false, true, false, false, true, false]);
});

test('a different unavailable message is applied', () => {
  const tracker = new AvailabilityTracker();
  tracker.changed('Device not found');
  assert.equal(tracker.changed('Device offline'), true);
  assert.equal(tracker.changed('Device offline'), false);
});

test('after a failed apply the next update retries', () => {
  const tracker = new AvailabilityTracker();
  assert.equal(tracker.changed('Device offline'), true);
  tracker.forget();
  assert.equal(tracker.changed('Device offline'), true);
  assert.equal(tracker.changed('Device offline'), false);
});

/** A device stand-in that records availability calls; `failNext` makes the next call reject. */
function fakeDevice() {
  const calls: string[] = [];
  let failNext = false;
  const device: AvailabilityTarget = {
    setAvailable: async () => {
      calls.push('available');
      if (failNext) { failNext = false; throw new Error('Homey busy'); }
    },
    setUnavailable: async (message) => {
      calls.push(`unavailable: ${message}`);
      if (failNext) { failNext = false; throw new Error('Homey busy'); }
    },
  };
  return { device, calls, failNextCall: () => { failNext = true; } };
}

test('update calls Homey only when availability changes', async () => {
  const tracker = new AvailabilityTracker();
  const { device, calls } = fakeDevice();
  for (const reason of [null, null, null, 'Device offline', 'Device offline', null]) {
    await tracker.update(device, reason);
  }
  assert.deepEqual(calls, ['available', 'unavailable: Device offline', 'available']);
});

test('update rethrows a failed call and retries it on the next update', async () => {
  const tracker = new AvailabilityTracker();
  const { device, calls, failNextCall } = fakeDevice();
  failNextCall();
  await assert.rejects(tracker.update(device, 'Device not found'), /Homey busy/);
  await tracker.update(device, 'Device not found');
  await tracker.update(device, 'Device not found');
  assert.deepEqual(calls, ['unavailable: Device not found', 'unavailable: Device not found']);
});
