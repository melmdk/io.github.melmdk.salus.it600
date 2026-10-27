import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayConnection } from '../lib/gateway-connection';
import type { ConnectTarget, ManagedGateway, SettingsStore } from '../lib/gateway-connection';
import type { GatewayStatus } from '../lib/gateway-settings';
import { IT600UnreachableError } from '../lib/salus-api';
import type { ProtocolName } from '../lib/protocol';

const EUID = '0123456789ABCDEF';
const HOST = '10.0.0.9';

/** A promise with its resolve/reject exposed. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued promise callbacks run. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** In-memory settings that record every write. */
function fakeSettings(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial));
  const writes: Array<{ key: string; value: unknown }> = [];
  const store: SettingsStore = {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      // Like Homey: the stored value is a copy.
      values.set(key, JSON.parse(JSON.stringify(value)));
      writes.push({ key, value });
    },
  };
  return { store, values, writes, writesTo: (key: string) => writes.filter((w) => w.key === key).map((w) => w.value) };
}

/** A gateway client whose connect and polls the test decides. */
class FakeGateway implements ManagedGateway {
  connectCalls = 0;
  polls = 0;
  combined: boolean | null = null;
  constructor(
    readonly target: ConnectTarget,
    private readonly onConnect: () => Promise<{ protocol: ProtocolName }>,
    private readonly onPoll: () => Promise<void> = async () => undefined,
  ) {}

  connect() {
    this.connectCalls += 1;
    return this.onConnect();
  }

  setCombinedDetailRequests(enabled: boolean) {
    this.combined = enabled;
  }

  pollStatus() {
    this.polls += 1;
    return this.onPoll();
  }
}

type Behaviour = {
  connect?: () => Promise<{ protocol: ProtocolName }>;
  poll?: () => Promise<void>;
};

/**
 * A connection over fake settings. Each connect attempt builds the next
 * behaviour from `behaviours` (the last one repeats).
 */
function setup(opts: { settings?: Record<string, unknown>; behaviours?: Behaviour[] } = {}) {
  const settings = fakeSettings(opts.settings);
  const created: FakeGateway[] = [];
  const logs: unknown[][] = [];
  const errors: unknown[][] = [];
  let updates = 0;
  const behaviours = opts.behaviours ?? [{}];
  const connection = new GatewayConnection<FakeGateway>({
    settings: settings.store,
    logger: { log: (...args) => logs.push(args), error: (...args) => errors.push(args) },
    createGateway: (target) => {
      const behaviour = behaviours[Math.min(created.length, behaviours.length - 1)];
      const gateway = new FakeGateway(
        target,
        behaviour.connect ?? (async () => ({ protocol: 'aes-256-cbc' })),
        behaviour.poll,
      );
      created.push(gateway);
      return gateway;
    },
    onDevicesUpdated: () => {
      updates += 1;
    },
  });
  return { connection, settings, created, logs, errors, updates: () => updates };
}

const SAVED = { host: HOST, euid: EUID, protocol: 'aes-256-cbc', combinedDetails: true };
const unreachable = () => Promise.reject(new IT600UnreachableError(`No gateway answering at ${HOST}`));

test('connects run one at a time', async () => {
  const first = deferred<{ protocol: ProtocolName }>();
  const { connection, created } = setup({
    behaviours: [{ connect: () => first.promise }, { connect: async () => ({ protocol: 'aes-128-cbc' }) }],
  });

  const one = connection.connect(HOST, EUID);
  const two = connection.connect('10.0.0.10', EUID);
  await flush();
  assert.equal(created.length, 1, 'the second connect waits for the first');

  first.resolve({ protocol: 'aes-256-cbc' });
  assert.equal(await one, created[0]);
  assert.equal(await two, created[1]);
  // The second attempt started from what the first persisted: same EUID, so its protocol carries over.
  assert.equal(created[1].target.protocol, 'aes-256-cbc');
  assert.equal(connection.getGateway(), created[1]);
});

test('a failed connect does not block the next one', async () => {
  const { connection, created } = setup({ behaviours: [{ connect: unreachable }, {}] });
  await assert.rejects(connection.connect(HOST, EUID), IT600UnreachableError);
  assert.equal(await connection.connect(HOST, EUID), created[1]);
});

test('a failed connect keeps the previous gateway', async () => {
  const { connection, settings, created } = setup({ behaviours: [{}, { connect: unreachable }] });
  await connection.connect(HOST, EUID);
  const saved = settings.values.get('gateway');

  await assert.rejects(connection.connect('10.0.0.3', 'FEDCBA9876543210'), (err: Error) => {
    assert.equal(err.message, `No gateway answering at ${HOST}`);
    return true;
  });
  assert.equal(connection.getGateway(), created[0]);
  assert.deepEqual(settings.values.get('gateway'), saved, 'the failed pair is not persisted');
  assert.deepEqual(
    { ...(settings.values.get('gateway_status') as GatewayStatus), at: undefined },
    { ok: false, message: `No gateway answering at ${HOST}`, at: undefined },
  );
});

test('a successful connect persists the detected protocol and applies combined requests', async () => {
  const { connection, settings, created } = setup({
    behaviours: [{ connect: async () => ({ protocol: 'aes-256-ccm' }) }],
  });
  await connection.connect(` ${HOST} `, '0123 4567 89ab cdef', false);
  assert.deepEqual(settings.values.get('gateway'), {
    host: HOST, euid: EUID, protocol: 'aes-256-ccm', combinedDetails: false,
  });
  assert.equal(created[0].combined, false);
  assert.equal((settings.values.get('gateway_status') as GatewayStatus).message, `Connected to ${HOST}`);
});

test('a poll skips while a connect is pending', async () => {
  const replacement = deferred<{ protocol: ProtocolName }>();
  const { connection, created } = setup({ behaviours: [{}, { connect: () => replacement.promise }] });
  await connection.connect(HOST, EUID);

  const pending = connection.connect(HOST, EUID);
  await flush();
  await connection.pollOnce();
  assert.equal(created[0].polls, 0, 'the old gateway is not polled');
  assert.equal(created.length, 2, 'no extra reconnect');

  replacement.resolve({ protocol: 'aes-256-cbc' });
  await pending;
  await connection.pollOnce();
  assert.equal(created[1].polls, 1);
});

test('the poll-drop guard keeps a gateway a user connect just installed', async () => {
  const slowPoll = deferred();
  const { connection, created, errors } = setup({ behaviours: [{ poll: () => slowPoll.promise }, {}] });
  await connection.connect(HOST, EUID);

  // A poll of the old gateway is in flight when the user connects (repair, settings save).
  const polling = connection.pollOnce();
  await flush();
  await connection.connect(HOST, EUID);
  assert.equal(connection.getGateway(), created[1]);

  slowPoll.reject(new Error('Gateway request timeout'));
  await polling;
  assert.equal(connection.getGateway(), created[1], 'the new gateway survives the old poll failing');
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], 'Polling error:');
});

test('a failed poll drops the gateway so the next tick reconnects', async () => {
  const { connection, created } = setup({
    settings: { gateway: SAVED },
    behaviours: [{ poll: () => Promise.reject(new Error('Gateway request timeout')) }, {}],
  });
  await connection.connect(HOST, EUID);
  await connection.pollOnce();
  assert.equal(connection.getGateway(), null);

  await connection.pollOnce();
  assert.equal(created.length, 2);
  assert.equal(connection.getGateway(), created[1]);
  assert.equal(created[1].polls, 1);
});

test('background reconnects write the status only when it changes; user connects always write', async () => {
  const { connection, settings } = setup({
    settings: { gateway: SAVED },
    behaviours: [{ connect: unreachable }, { connect: unreachable }, { connect: unreachable }, {}, {}],
  });

  await connection.pollOnce();
  await connection.pollOnce();
  assert.equal(settings.writesTo('gateway_status').length, 1, 'same failure twice: one write');

  await assert.rejects(connection.connect(HOST, EUID));
  assert.equal(settings.writesTo('gateway_status').length, 2, 'a user connect always reports');

  await connection.pollOnce();
  const statuses = settings.writesTo('gateway_status') as GatewayStatus[];
  assert.equal(statuses.length, 3, 'the outcome changed');
  assert.equal(statuses[2].ok, true);
  assert.equal(statuses[2].message, `Connected to ${HOST}`);
});

test('the boot-time migration writes older settings once, in the current shape', async () => {
  const legacy = setup({ settings: { gateway: { host: ` ${HOST}`, euid: '0123 4567 89ab cdef' } }, behaviours: [{ connect: unreachable }] });
  await legacy.connection.start();
  assert.deepEqual(legacy.settings.writesTo('gateway'), [{ host: HOST, euid: EUID, combinedDetails: true }]);
  assert.equal(legacy.errors[legacy.errors.length - 1][0], 'Initial gateway connection failed, will retry via polling:');

  const separateKeys = setup({ settings: { host: HOST, euid: EUID }, behaviours: [{ connect: unreachable }] });
  await separateKeys.connection.start();
  assert.deepEqual(separateKeys.settings.writesTo('gateway'), [{ host: HOST, euid: EUID, combinedDetails: true }]);

  const current = setup({ settings: { gateway: SAVED }, behaviours: [{ connect: unreachable }] });
  await current.connection.start();
  assert.deepEqual(current.settings.writesTo('gateway'), [], 'already current: nothing written');

  const none = setup();
  await none.connection.start();
  assert.equal(none.created.length, 0, 'no settings: no connect');
  assert.deepEqual(none.settings.writes, []);
});

test('start connects with the stored protocol and polls once', async () => {
  const { connection, created, updates } = setup({ settings: { gateway: SAVED } });
  await connection.start();
  assert.equal(created.length, 1);
  assert.equal(created[0].target.protocol, 'aes-256-cbc');
  assert.equal(created[0].polls, 1);
  assert.equal(updates(), 1);
});

test('settings page input reconnects with the pair and its combined-requests choice', async () => {
  const { connection, settings, created, errors } = setup();
  await connection.applyInput({ host: HOST, euid: '0123456789abcdef', combinedDetails: false, at: 1 });
  assert.equal(created[0].target.euid, EUID);
  assert.equal(created[0].polls, 1);
  assert.equal((settings.values.get('gateway') as { combinedDetails: boolean }).combinedDetails, false);

  await connection.applyInput({ host: HOST });
  assert.equal(created.length, 1, 'incomplete input is ignored');
  assert.equal(errors[0][0], 'Ignoring incomplete gateway settings from the settings page');
});
