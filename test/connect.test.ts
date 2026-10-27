import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import {
  IT600AuthenticationError,
  IT600CommandError,
  IT600ConnectionError,
  IT600Gateway,
  IT600UnreachableError,
  IT600UnsupportedFirmwareError,
} from '../lib/salus-api';
import { AesCbcProtocol, AesCcmProtocol, ProtocolName } from '../lib/protocol';
import type { Transport } from '../lib/transport';
import { loadFixture } from './helpers/fixtures';
import { fakeGateway, FakeGatewayOptions } from './helpers/fake-gateway';

const EUID = '0123456789ABCDEF';
const HOST = '10.0.0.9';
const fixtures = { readall: loadFixture('readall') };

function setup(
  fake: Partial<FakeGatewayOptions> = {},
  client: { euid?: string; protocol?: ProtocolName | string } = {},
) {
  const transport = fakeGateway({ protocol: 'aes-256-cbc', euid: EUID, fixtures, ...fake });
  const gateway = new IT600Gateway(client.euid ?? EUID, HOST, {
    transport,
    protocol: client.protocol as ProtocolName | undefined,
  });
  return { transport, gateway };
}

for (const protocol of ['aes-256-cbc', 'aes-128-cbc', 'aes-256-ccm'] as const) {
  test(`detects ${protocol}`, async () => {
    const { transport, gateway } = setup({ protocol });
    const result = await gateway.connect();
    assert.equal(result.protocol, protocol);
    assert.equal(result.gatewayMac, 'REDACTED');
    assert.equal(gateway.protocolName, protocol);
    if (protocol === 'aes-256-ccm') assert.equal(transport.requests.length, 3);
  });
}

test('uses stored protocol without probing', async () => {
  const { transport, gateway } = setup({ protocol: 'aes-256-ccm' }, { protocol: 'aes-256-ccm' });
  const result = await gateway.connect();
  assert.equal(result.protocol, 'aes-256-ccm');
  assert.equal(transport.requests.length, 1);
});

test('falls back to detection when stored protocol fails', async () => {
  const { transport, gateway } = setup({ protocol: 'aes-256-cbc' }, { protocol: 'aes-128-cbc' });
  const result = await gateway.connect();
  assert.equal(result.protocol, 'aes-256-cbc');
  assert.equal(transport.requests.length, 2);
});

test('invalid stored protocol is treated as none', async () => {
  const { transport, gateway } = setup({ protocol: 'aes-128-cbc' }, { protocol: 'rot13' });
  assert.equal(gateway.protocolName, null);
  const result = await gateway.connect();
  assert.equal(result.protocol, 'aes-128-cbc');
  assert.equal(transport.requests.length, 2);
});

test('normalises euid typed with spaces and lowercase', async () => {
  const { gateway } = setup({ protocol: 'aes-256-cbc' }, { euid: ' 0123 4567 89ab cdef ' });
  assert.equal((await gateway.connect()).protocol, 'aes-256-cbc');
});

test('wrong euid maps to authentication error', async () => {
  const { gateway } = setup({ euid: 'FEDCBA9876543210' });
  await assert.rejects(gateway.connect(), (err: Error) => {
    assert.ok(err instanceof IT600AuthenticationError);
    assert.equal(err.message, 'Wrong EUID: check the 16 characters on the gateway label');
    return true;
  });
});

test('connect reports unreachable', async () => {
  const { gateway } = setup({ unreachable: true });
  await assert.rejects(gateway.connect(), (err: Error) => {
    assert.ok(err instanceof IT600ConnectionError);
    assert.equal(err.message, 'No gateway answering at 10.0.0.9');
    return true;
  });
});

test('unreachable host costs a single protocol request', async () => {
  const { transport, gateway } = setup({ unreachable: true });
  await assert.rejects(gateway.connect(), IT600ConnectionError);
  assert.equal(transport.requests.length, 1);
});

test('transient network errors are not reported as wrong EUID', async () => {
  const { gateway } = setup({ failFirst: 3 });
  await assert.rejects(gateway.connect(), (err: Error) => {
    assert.ok(err instanceof IT600ConnectionError);
    assert.equal(err.message, 'No gateway answering at 10.0.0.9');
    return true;
  });
});

test('a transient error on one candidate does not yield a wrong-EUID verdict', async () => {
  // The first candidate (the right one) is lost to the network error; the
  // others only see undecryptable frames, which proves nothing about the EUID.
  const { gateway } = setup({ failFirst: 1 });
  await assert.rejects(gateway.connect(), IT600ConnectionError);
});

test('a network error on the stored protocol does not re-detect', async () => {
  // The root answers, so this is not "unreachable"; but probing the other
  // protocols on every reconnect tick would only add requests.
  const { transport, gateway } = setup({ protocol: 'aes-256-cbc', failFirst: 1 }, { protocol: 'aes-256-cbc' });
  await assert.rejects(gateway.connect(), (err: Error) => {
    assert.ok(err instanceof IT600ConnectionError);
    assert.ok(!(err instanceof IT600UnreachableError));
    return true;
  });
  assert.equal(transport.requests.length, 1);
  assert.equal(gateway.protocolName, 'aes-256-cbc');

  // The next reconnect tick uses the stored protocol again and succeeds.
  assert.equal((await gateway.connect()).protocol, 'aes-256-cbc');
  assert.equal(transport.requests.length, 2);
});

test('an empty response is a network error, not a wrong EUID', async () => {
  const empty: Transport = Object.assign(async () => Buffer.alloc(0), { probeRoot: async () => undefined });
  let requests = 0;
  const counting: Transport = Object.assign(async (p: string, b: Buffer) => {
    requests += 1;
    return empty(p, b);
  }, { probeRoot: empty.probeRoot });

  await assert.rejects(new IT600Gateway(EUID, HOST, { transport: counting }).connect(), (err: Error) => {
    assert.ok(err instanceof IT600ConnectionError);
    assert.ok(!(err instanceof IT600AuthenticationError));
    return true;
  });
  assert.equal(requests, 3, 'every candidate tried');

  // With a stored protocol it stops after the one request.
  requests = 0;
  await assert.rejects(
    new IT600Gateway(EUID, HOST, { transport: counting, protocol: 'aes-256-cbc' }).connect(),
    IT600ConnectionError,
  );
  assert.equal(requests, 1);
});

test('reject frames map to unsupported firmware', async () => {
  const vectors = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/protocol-vectors.json'), 'utf8'),
  ) as { rejectFrameCase: { euid: string; wireHex: string } };
  const { rejectFrameCase } = vectors;
  // The recorded frame is a genuine reject under the client's key.
  assert.equal(
    new AesCbcProtocol(rejectFrameCase.euid).unwrapResponse(Buffer.from(rejectFrameCase.wireHex, 'hex')),
    '{"status":"fail"}',
  );
  const { gateway } = setup({ reject: true });
  await assert.rejects(gateway.connect(), (err: Error) => {
    assert.ok(err instanceof IT600UnsupportedFirmwareError);
    assert.equal(err.message, "Gateway firmware uses an encryption this app doesn't support");
    return true;
  });
});

/** What Node's fatal TextDecoder throws for bytes that are not UTF-8. */
const INVALID_UTF8 = (err: Error & { code?: string }) => {
  assert.ok(err instanceof TypeError, err.message);
  assert.equal(err.code, 'ERR_ENCODING_INVALID_ENCODED_DATA');
  return true;
};
const NOT_UTF8 = Buffer.from([0xff, 0xfe]);

test('a cbc frame that decrypts to invalid utf-8 throws', () => {
  // Bytes ff fe encrypted under the right key: valid PKCS7 padding, but not UTF-8.
  const md5 = crypto.createHash('md5').update(`Salus-${EUID.toLowerCase()}`).digest();
  const key = Buffer.concat([md5, Buffer.alloc(16)]);
  const iv = Buffer.from([0x88, 0xa6, 0xb0, 0x79, 0x5d, 0x85, 0xdb, 0xfc, 0xe6, 0xe0, 0xb3, 0xe9, 0xa6, 0x29, 0x65, 0x4b]);
  const c = crypto.createCipheriv('aes-256-cbc', key, iv);
  const wire = Buffer.concat([c.update(NOT_UTF8), c.final()]);
  assert.throws(() => new AesCbcProtocol(EUID).unwrapResponse(wire), INVALID_UTF8);
});

test('a ccm frame that decrypts to invalid utf-8 throws', () => {
  // Bytes ff fe sealed under the right key and a valid tag: authentic, but not UTF-8.
  const key = Buffer.concat([Buffer.from(EUID, 'hex'), Buffer.from('9a4ba190ac2b5139b32c3528', 'ascii')]);
  const nonce = Buffer.from('a1b2c30001765432', 'hex');
  const c = crypto.createCipheriv('aes-256-ccm', key, nonce, { authTagLength: 8 });
  const ciphertext = c.update(NOT_UTF8);
  c.final();
  const wire = Buffer.concat([ciphertext, c.getAuthTag(), nonce]);
  assert.throws(() => new AesCcmProtocol(EUID).unwrapResponse(wire), INVALID_UTF8);
});

test('one candidate rejected and the others undecryptable is unsupported firmware', async () => {
  // The gateway speaks cbc-128 but refuses every request: cbc-256 and ccm see
  // frames they cannot decrypt, cbc-128 sees a readable rejection.
  const { transport, gateway } = setup({ protocol: 'aes-128-cbc', reject: true });
  await assert.rejects(gateway.connect(), (err: Error) => {
    assert.ok(err instanceof IT600UnsupportedFirmwareError);
    assert.equal(err.message, "Gateway firmware uses an encryption this app doesn't support");
    return true;
  });
  assert.equal(transport.requests.length, 3, 'every candidate tried');
});

test('a readall without gateway information fails the connect', async () => {
  const readall = loadFixture('readall');
  const withoutGateway = { ...readall, id: (readall.id ?? []).filter((device) => !device.sGateway) };
  const { gateway } = setup({ fixtures: { readall: withoutGateway } });
  await assert.rejects(gateway.connect(), (err: Error) => {
    assert.ok(err instanceof IT600CommandError);
    assert.equal(err.message, 'Gateway response did not contain gateway information');
    return true;
  });
});
