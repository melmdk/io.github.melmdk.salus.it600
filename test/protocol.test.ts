import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import {
  AesCbcProtocol,
  AesCcmProtocol,
  createProtocol,
  normaliseEuid,
  protocolCandidates,
} from '../lib/protocol';

interface EuidVectors {
  euid: string;
  cbc256Hex: string;
  cbc128Hex: string;
  ccmNonceHex: string;
  ccmWireHex: string;
}
interface Case { euid: string; plaintext: string; wireHex: string }
interface Vectors {
  plaintext: string;
  euids: { euid16: EuidVectors; euid12: EuidVectors };
  cbcTrailerCase: Case;
  rejectFrameCase: Case;
}

// Compiled to .test-build/test, fixtures live in the source tree.
const vectors = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/protocol-vectors.json'), 'utf8'),
) as Vectors;
const hex = (value: string): Buffer => Buffer.from(value, 'hex');

test('cbc256 matches reference vector', () => {
  const v = vectors.euids.euid16;
  const proto = new AesCbcProtocol(v.euid);
  assert.equal(proto.name, 'aes-256-cbc');
  assert.equal(proto.wrapRequest(vectors.plaintext).toString('hex'), v.cbc256Hex);
  assert.equal(proto.unwrapResponse(hex(v.cbc256Hex)), vectors.plaintext);
});

test('cbc128 matches reference vector', () => {
  const v = vectors.euids.euid16;
  const proto = new AesCbcProtocol(v.euid, { aes128: true });
  assert.equal(proto.name, 'aes-128-cbc');
  assert.equal(proto.wrapRequest(vectors.plaintext).toString('hex'), v.cbc128Hex);
  assert.equal(proto.unwrapResponse(hex(v.cbc128Hex)), vectors.plaintext);
});

test('cbc unwrap ignores non-block-aligned trailer', () => {
  const c = vectors.cbcTrailerCase;
  const raw = hex(c.wireHex);
  assert.notEqual(raw.length % 16, 0);
  assert.equal(new AesCbcProtocol(c.euid).unwrapResponse(raw), c.plaintext);
});

test('cbc decrypts the reject frame to its status JSON', () => {
  const c = vectors.rejectFrameCase;
  assert.equal(new AesCbcProtocol(c.euid).unwrapResponse(hex(c.wireHex)), c.plaintext);
});

for (const [label, key] of [['16-char', 'euid16'], ['12-char', 'euid12']] as const) {
  test(`ccm ${label} euid vector`, () => {
    const v = vectors.euids[key];
    const proto = new AesCcmProtocol(v.euid, () => hex(v.ccmNonceHex));
    assert.equal(proto.name, 'aes-256-ccm');
    assert.equal(proto.wrapRequest(vectors.plaintext).toString('hex'), v.ccmWireHex);
    assert.equal(proto.unwrapResponse(hex(v.ccmWireHex)), vectors.plaintext);
  });
}

/** Node's message when a CCM tag doesn't verify. */
const CCM_AUTH_FAILURE = /Unsupported state or unable to authenticate data/;

test('ccm rejects tampered tag', () => {
  const v = vectors.euids.euid16;
  const wire = hex(v.ccmWireHex);
  wire[wire.length - 8 - 1] ^= 0x01; // last tag byte
  assert.throws(() => new AesCcmProtocol(v.euid).unwrapResponse(wire), CCM_AUTH_FAILURE);
});

test('ccm rejects data that is too short', () => {
  // tag (8) + nonce (8) and no ciphertext: refused before decrypting.
  assert.throws(
    () => new AesCcmProtocol('0123456789ABCDEF').unwrapResponse(Buffer.alloc(16)),
    /Data too short for CCM \(16 bytes\)/,
  );
});

test('ccm accepts 17 bytes as long enough and fails only on the tag', () => {
  // One ciphertext byte is the shortest frame that gets to decryption.
  assert.throws(() => new AesCcmProtocol('0123456789ABCDEF').unwrapResponse(Buffer.alloc(17)), (err: Error) => {
    assert.doesNotMatch(err.message, /too short/);
    assert.match(err.message, CCM_AUTH_FAILURE);
    return true;
  });
});

test('ccm constructor throws on a non-hex EUID', () => {
  assert.throws(() => new AesCcmProtocol('not-hex-euid!'), /EUID is not hex; AES-CCM unavailable/);
  assert.throws(() => new AesCcmProtocol('0123456789ABCDE'), /EUID is not hex/, 'odd length');
  assert.throws(() => new AesCcmProtocol(''), /EUID is not hex/, 'empty');
});

test('ccm default nonce is 8 bytes and counter increments', (t) => {
  // 0x12345678 s: the nonce carries the low three bytes, big-endian.
  t.mock.method(Date, 'now', () => 0x12345678 * 1000 + 999);
  const proto = new AesCcmProtocol('0123456789ABCDEF');
  const a = proto.wrapRequest(vectors.plaintext);
  const b = proto.wrapRequest(vectors.plaintext);
  const nonceA = a.subarray(a.length - 8);
  const nonceB = b.subarray(b.length - 8);
  assert.equal(nonceA.length, 8);
  assert.equal(nonceA.readUInt16BE(3), 0);
  assert.equal(nonceB.readUInt16BE(3), 1);
  assert.deepEqual([...nonceA.subarray(5)], [0x34, 0x56, 0x78]);
  assert.deepEqual([...nonceB.subarray(5)], [0x34, 0x56, 0x78]);
  assert.equal(proto.unwrapResponse(a), vectors.plaintext);
  assert.equal(proto.unwrapResponse(b), vectors.plaintext);
});

test('normalises euid input', () => {
  assert.equal(normaliseEuid(' 0123 4567 89ab cdef '), '0123456789ABCDEF');
  const lower = new AesCbcProtocol('0123456789abcdef').wrapRequest(vectors.plaintext);
  const upper = new AesCbcProtocol('0123456789ABCDEF').wrapRequest(vectors.plaintext);
  assert.equal(lower.toString('hex'), upper.toString('hex'));
});

test('candidates are in probe order', () => {
  assert.deepEqual(
    protocolCandidates('0123456789ABCDEF').map((p) => p.name),
    ['aes-256-cbc', 'aes-128-cbc', 'aes-256-ccm'],
  );
  assert.deepEqual(
    protocolCandidates('not-hex-euid!').map((p) => p.name),
    ['aes-256-cbc', 'aes-128-cbc'],
  );
});

test('createProtocol builds each named protocol', () => {
  for (const name of ['aes-256-cbc', 'aes-128-cbc', 'aes-256-ccm'] as const) {
    assert.equal(createProtocol(name, '0123456789ABCDEF').name, name);
  }
});

test('createProtocol throws on an unknown name', () => {
  assert.throws(() => createProtocol('rot13' as never, '0123456789ABCDEF'), /Unknown protocol/);
});
