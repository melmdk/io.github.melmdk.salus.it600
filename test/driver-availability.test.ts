import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type { BinarySensorDevice, CoverDevice, SensorDevice, SwitchDevice } from '../lib/device-types';

/**
 * Drivers import the Homey runtime, which does not exist under node:test, so
 * `homey` is replaced by a minimal Device that records availability calls.
 */
const calls: string[] = [];
let failNext = false;
let gateway: unknown = null;

class FakeDevice {
  homey = { app: { getGateway: () => gateway, pollNow: async () => undefined }, on: () => undefined, off: () => undefined };
  getData() { return { id: 'dev-1' }; }
  getName() { return 'Test device'; }
  log() { /* quiet */ }
  error() { /* quiet */ }
  hasCapability() { return true; }
  async addCapability() { /* present already */ }
  registerCapabilityListener() { /* unused */ }
  getCapabilityValue() { return undefined; }
  async setCapabilityValue() { /* unused */ }
  async setAvailable() {
    calls.push('available');
    if (failNext) { failNext = false; throw new Error('Homey busy'); }
  }
  async setUnavailable(message?: string | null) {
    calls.push(`unavailable: ${message}`);
    if (failNext) { failNext = false; throw new Error('Homey busy'); }
  }
}

type Loader = (request: string, ...rest: unknown[]) => unknown;
const internals = Module as unknown as { _load: Loader };
const realLoad = internals._load;
internals._load = (request, ...rest) => (
  request === 'homey' ? { Device: FakeDevice, App: class {} } : realLoad.call(Module, request, ...rest)
);

interface Updatable { onInit(): Promise<void>; updateState(): Promise<void> }

/** One driver under test: the gateway getter it reads and a device it can show (the fields it uses). */
interface DriverCase { name: string; getter: string; data: Partial<BinarySensorDevice | CoverDevice | SwitchDevice | SensorDevice> }

const drivers: DriverCase[] = [
  { name: 'binary-sensor', getter: 'getBinarySensorDevice', data: { available: true, isOn: false } as Partial<BinarySensorDevice> },
  { name: 'cover', getter: 'getCoverDevice', data: { available: true, currentPosition: 50, isOpening: false, isClosing: false } as Partial<CoverDevice> },
  { name: 'switch', getter: 'getSwitchDevice', data: { available: true, isOn: false } as Partial<SwitchDevice> },
  { name: 'temperature-sensor', getter: 'getSensorDevice', data: { available: true, state: 20 } as Partial<SensorDevice> },
];

for (const { name, getter, data } of drivers) {
  const load = async (): Promise<Updatable> => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const DeviceClass = require(`../drivers/${name}/device`) as new () => Updatable;
    return new DeviceClass();
  };
  /** Make the gateway answer with `state`: a device, or undefined for a device it does not know. */
  const answer = (state: object | undefined): void => {
    gateway = { [getter]: () => (state ? { ...data, ...state } : undefined) };
  };

  test(`${name}: availability is set only when it changes`, async () => {
    calls.length = 0;
    failNext = false;
    answer({});
    const device = await load();
    await device.onInit();
    for (const state of [{}, {}, { available: false }, { available: false }, undefined, undefined, {}, {}]) {
      answer(state);
      await device.updateState();
    }
    assert.deepEqual(calls, ['available', 'unavailable: Device offline', 'unavailable: Device not found', 'available']);
  });

  test(`${name}: a failed availability call is retried on the next poll`, async () => {
    calls.length = 0;
    answer({ available: false });
    const device = await load();
    failNext = true;
    await device.onInit();
    await device.updateState();
    await device.updateState();
    assert.deepEqual(calls, ['unavailable: Device offline', 'unavailable: Device offline']);
  });
}
