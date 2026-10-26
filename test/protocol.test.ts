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

test('ccm rejects tampered tag', () => {
  const v = vectors.euids.euid16;
  const wire = hex(v.ccmWireHex);
  wire[wire.length - 8 - 1] ^= 0x01; // last tag byte
  assert.throws(() => new AesCcmProtocol(v.euid).unwrapResponse(wire));
});

test('ccm rejects data that is too short', () => {
  assert.throws(() => new AesCcmProtocol('0123456789ABCDEF').unwrapResponse(Buffer.alloc(16)));
});

test('ccm default nonce is 8 bytes and counter increments', () => {
  const proto = new AesCcmProtocol('0123456789ABCDEF');
  const a = proto.wrapRequest(vectors.plaintext);
  const b = proto.wrapRequest(vectors.plaintext);
  const nonceA = a.subarray(a.length - 8);
  const nonceB = b.subarray(b.length - 8);
  assert.equal(nonceA.readUInt16BE(3), 0);
  assert.equal(nonceB.readUInt16BE(3), 1);
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
