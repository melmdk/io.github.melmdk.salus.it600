import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IT600ConnectionError, IT600Gateway } from '../lib/salus-api';
import { registerGatewayPairing, registerGatewayRepair, SalusAppApi } from '../lib/pairing';
import type { GatewayPairSession } from '../lib/pairing';
import type { PairingDeviceData } from '../lib/device-types';
import { loadFixture } from './helpers/fixtures';
import { fakeGateway, FakeGatewayOptions } from './helpers/fake-gateway';

const EUID = '0123456789ABCDEF';
const HOST = '10.0.0.9';
const fixtures = { readall: loadFixture('readall') };

type Handler = (data: unknown) => Promise<unknown>;

/** Records handlers and every view the helper navigates to. */
function fakeSession() {
  const handlers = new Map<string, Handler>();
  const shown: string[] = [];
  const session: GatewayPairSession = {
    setHandler(event: string, handler: Handler) {
      handlers.set(event, handler);
      return session;
    },
    async showView(viewId: string) {
      shown.push(viewId);
    },
  };
  const trigger = (event: string, data?: unknown): Promise<unknown> => {
    const handler = handlers.get(event);
    assert.ok(handler, `no handler for ${event}`);
    return handler(data);
  };
  return { session, handlers, shown, trigger };
}

/** App whose connectGateway talks to an in-memory gateway, like app.ts does over HTTP. */
function fakeApp(opts: {
  gateway?: IT600Gateway | null;
  fake?: Partial<FakeGatewayOptions>;
  savedHost?: string | null;
  refreshDevices?: () => Promise<void>;
} = {}) {
  let gateway = opts.gateway ?? null;
  const connects: Array<{ host: string; euid: string }> = [];
  let refreshes = 0;
  const app: SalusAppApi = {
    getGateway: () => gateway,
    async connectGateway(host: string, euid: string) {
      connects.push({ host, euid });
      const transport = fakeGateway({ protocol: 'aes-256-cbc', euid: EUID, fixtures, ...opts.fake });
      const connected = new IT600Gateway(euid, host, { transport });
      await connected.connect();
      gateway = connected;
      return connected;
    },
    async refreshDevices() {
      refreshes += 1;
      await opts.refreshDevices?.();
    },
    getSavedHost: () => opts.savedHost ?? null,
  };
  return { app, connects, refreshCount: () => refreshes };
}

const connectedGateway = () => new IT600Gateway(EUID, HOST, {
  transport: fakeGateway({ protocol: 'aes-256-cbc', euid: EUID, fixtures }),
});

const device = (id: string, name: string): PairingDeviceData => ({
  name,
  data: { id },
  store: { deviceData: { UniID: id } },
});

test('pairing skips credentials when connected', async () => {
  const { session, shown, trigger } = fakeSession();
  const { app } = fakeApp({ gateway: connectedGateway() });
  registerGatewayPairing(session, app, () => []);

  await trigger('showView', 'gateway_credentials');
  assert.deepEqual(shown, ['list_devices']);

  // Other views are left alone.
  await trigger('showView', 'list_devices');
  assert.deepEqual(shown, ['list_devices']);
});

test('pairing shows credentials when gateway down', async () => {
  const { session, shown, trigger } = fakeSession();
  const { app } = fakeApp({ gateway: null, fake: { unreachable: true } });
  registerGatewayPairing(session, app, () => []);

  await trigger('showView', 'gateway_credentials');
  assert.deepEqual(shown, []);

  await assert.rejects(trigger('login', { username: HOST, password: EUID }), (err: Error) => {
    assert.equal(err.message, `No gateway answering at ${HOST}`);
    return true;
  });
  assert.equal(app.getGateway(), null);
});

test('login connects through the app and continues', async () => {
  const { session, trigger } = fakeSession();
  const { app, connects } = fakeApp();
  registerGatewayPairing(session, app, () => []);

  assert.equal(await trigger('login', { username: ` ${HOST} `, password: ' 0123 4567 89ab cdef ' }), true);
  assert.deepEqual(connects, [{ host: HOST, euid: '0123 4567 89ab cdef' }]);
  assert.ok(app.getGateway());
});

test('login maps wrong euid', async () => {
  const { session, trigger } = fakeSession();
  const { app } = fakeApp({ fake: { euid: 'FEDCBA9876543210' } });
  registerGatewayPairing(session, app, () => []);

  await assert.rejects(trigger('login', { username: HOST, password: EUID }), (err: Error) => {
    assert.equal(err.message, 'Wrong EUID: check the 16 characters on the gateway label');
    assert.doesNotMatch(err.message, /bad decrypt/);
    return true;
  });
});

test('login with a blank IP uses the saved host', async () => {
  const { session, trigger } = fakeSession();
  const { app, connects } = fakeApp({ savedHost: HOST });
  registerGatewayPairing(session, app, () => []);

  assert.equal(await trigger('login', { username: '  ', password: EUID }), true);
  assert.deepEqual(connects, [{ host: HOST, euid: EUID }]);
});

test('login with no IP at all is refused before connecting', async () => {
  const { session, trigger } = fakeSession();
  const { app, connects } = fakeApp();
  registerGatewayPairing(session, app, () => []);

  await assert.rejects(trigger('login', { username: '', password: EUID }), /Enter the gateway IP address/);
  assert.deepEqual(connects, []);
});

test('pairing list merges last-seen devices', async () => {
  const { session, trigger } = fakeSession();
  let polled = false;
  const { app, refreshCount } = fakeApp({
    gateway: connectedGateway(),
    refreshDevices: async () => {
      polled = true;
    },
  });
  // Mikkel is in the cached snapshot but drops out of the fresh poll; Bad
  // Børn is renamed by the fresh poll.
  registerGatewayPairing(session, app, () => (polled
    ? [device('bad', 'Bad Børn (new)'), device('stue', 'Stue')]
    : [device('mikkel', 'Mikkel'), device('bad', 'Bad Børn')]));

  const list = await trigger('list_devices') as PairingDeviceData[];
  assert.equal(refreshCount(), 1);
  assert.deepEqual(list.map((d) => d.name), ['Bad Børn (new)', 'Stue', 'Mikkel']);
});

test('pairing list without a gateway names the saved address', async () => {
  const { session, trigger } = fakeSession();
  const { app } = fakeApp({ gateway: null, savedHost: HOST });
  registerGatewayPairing(session, app, () => []);

  await assert.rejects(trigger('list_devices'), (err: Error) => {
    assert.equal(err.message, `No gateway answering at ${HOST}`);
    return true;
  });
});

test('pairing list without a gateway or a saved address asks for the IP', async () => {
  const { session, trigger } = fakeSession();
  const { app } = fakeApp({ gateway: null, savedHost: null });
  registerGatewayPairing(session, app, () => []);

  await assert.rejects(trigger('list_devices'), (err: Error) => {
    assert.equal(err.message, 'Enter the gateway IP address');
    return true;
  });
});

test('repair always asks, reconnects and refreshes', async () => {
  const { session, handlers, trigger } = fakeSession();
  const { app, connects, refreshCount } = fakeApp({ gateway: connectedGateway() });
  registerGatewayRepair(session, app);

  // No skip: repair exists to enter new credentials.
  assert.equal(handlers.has('showView'), false);
  assert.equal(await trigger('login', { username: HOST, password: EUID }), true);
  assert.deepEqual(connects, [{ host: HOST, euid: EUID }]);
  assert.equal(refreshCount(), 1);
});

test('repair maps connection errors', async () => {
  const { session, trigger } = fakeSession();
  const { app, refreshCount } = fakeApp({ fake: { unreachable: true } });
  registerGatewayRepair(session, app);

  await assert.rejects(trigger('login', { username: HOST, password: EUID }), (err: Error) => {
    assert.equal(err.message, `No gateway answering at ${HOST}`);
    return true;
  });
  assert.equal(refreshCount(), 0);
});

test('pairing list falls back to last-seen devices when the fresh poll fails', async () => {
  const timeout = () => Promise.reject(new IT600ConnectionError('Gateway request timeout'));
  const { session, trigger } = fakeSession();
  const { app } = fakeApp({ gateway: connectedGateway(), refreshDevices: timeout });
  registerGatewayPairing(session, app, () => [device('mikkel', 'Mikkel')]);

  const list = await trigger('list_devices') as PairingDeviceData[];
  assert.deepEqual(list.map((d) => d.name), ['Mikkel']);

  // Nothing seen before either: a user-facing error, never the raw transport text.
  const empty = fakeSession();
  registerGatewayPairing(empty.session, fakeApp({ gateway: connectedGateway(), refreshDevices: timeout }).app, () => []);
  await assert.rejects(empty.trigger('list_devices'), (err: Error) => {
    assert.equal(err.message, 'Could not connect to the gateway');
    return true;
  });
});

test('repair succeeds once connected even if the refresh fails', async () => {
  const { session, trigger } = fakeSession();
  const { app, connects } = fakeApp({
    refreshDevices: () => Promise.reject(new IT600ConnectionError('Gateway request timeout')),
  });
  registerGatewayRepair(session, app);

  // The connect was persisted; the poll loop retries the refresh.
  assert.equal(await trigger('login', { username: HOST, password: EUID }), true);
  assert.deepEqual(connects, [{ host: HOST, euid: EUID }]);
  assert.ok(app.getGateway());
});
