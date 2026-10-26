/**
 * Gateway wire protocols: AES-256-CBC, AES-128-CBC and AES-256-CCM.
 *
 * Ported from salus-it600-client 0.7.0 (MIT/Apache-2.0), protocol_aes_cbc.py
 * and protocol_aes_ccm.py. The schemes (fixed IV, MD5-derived key, fixed CCM
 * key suffix and nonce layout) are dictated by the gateway firmware and must
 * not be "hardened"; the gateway expects exactly this.
 */

import * as crypto from 'crypto';

import { ENCRYPTION_IV } from './constants';

export type ProtocolName = 'aes-256-cbc' | 'aes-128-cbc' | 'aes-256-ccm';

export interface GatewayProtocol {
  readonly name: ProtocolName;
  /** Encrypt a JSON request body into wire bytes. */
  wrapRequest(json: string): Buffer;
  /** Decrypt raw response bytes into a JSON string. Throws on failure. */
  unwrapResponse(raw: Buffer): string;
}

const BLOCK_SIZE = 16;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const CCM_SUFFIX = Buffer.from('9a4ba190ac2b5139b32c3528', 'ascii');
const CCM_TAG_LENGTH = 8;
const CCM_NONCE_LENGTH = 8;

/** Trim, remove all whitespace and uppercase an EUID. */
export function normaliseEuid(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/** AES-CBC with the fixed IV and PKCS7 padding (legacy UGE600/UG800 firmware). */
export class AesCbcProtocol implements GatewayProtocol {
  readonly name: ProtocolName;
  private readonly key: Buffer;
  private readonly algorithm: string;

  constructor(euid: string, opts: { aes128?: boolean } = {}) {
    const md5Key = crypto.createHash('md5').update(`Salus-${euid.toLowerCase()}`).digest();
    if (opts.aes128) {
      this.name = 'aes-128-cbc';
      this.algorithm = 'aes-128-cbc';
      this.key = md5Key;
    } else {
      this.name = 'aes-256-cbc';
      this.algorithm = 'aes-256-cbc';
      this.key = Buffer.concat([md5Key, Buffer.alloc(16)]);
    }
  }

  wrapRequest(json: string): Buffer {
    const cipher = crypto.createCipheriv(this.algorithm, this.key, ENCRYPTION_IV);
    return Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  }

  unwrapResponse(raw: Buffer): string {
    const aligned = raw.subarray(0, raw.length - (raw.length % BLOCK_SIZE));
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, ENCRYPTION_IV);
    return utf8.decode(Buffer.concat([decipher.update(aligned), decipher.final()]));
  }
}

function defaultNonce(counter: number): Buffer {
  const nonce = Buffer.alloc(CCM_NONCE_LENGTH);
  crypto.randomBytes(3).copy(nonce, 0);
  nonce.writeUInt16BE(counter & 0xffff, 3);
  const seconds = Math.floor(Date.now() / 1000);
  nonce[5] = (seconds >>> 16) & 0xff;
  nonce[6] = (seconds >>> 8) & 0xff;
  nonce[7] = seconds & 0xff;
  return nonce;
}

function deriveCcmKey(euid: string): Buffer {
  const clean = normaliseEuid(euid);
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9A-F]+$/.test(clean)) {
    throw new Error('EUID is not hex; AES-CCM unavailable');
  }
  let euidBytes = Buffer.from(clean, 'hex');
  if (euidBytes.length === 6) {
    euidBytes = Buffer.concat([euidBytes.subarray(0, 3), Buffer.from([0x09, 0x02]), euidBytes.subarray(3)]);
  }
  return Buffer.concat([euidBytes, CCM_SUFFIX]);
}

/** AES-256-CCM (newer UG800 firmware). Wire format: ciphertext || tag(8) || nonce(8). */
export class AesCcmProtocol implements GatewayProtocol {
  readonly name: ProtocolName = 'aes-256-ccm';
  private readonly key: Buffer;
  private counter = 0;

  constructor(euid: string, private readonly nonceFn: (counter: number) => Buffer = defaultNonce) {
    this.key = deriveCcmKey(euid);
  }

  wrapRequest(json: string): Buffer {
    const nonce = this.nonceFn(this.counter);
    this.counter = (this.counter + 1) & 0xffff;
    const cipher = crypto.createCipheriv('aes-256-ccm', this.key, nonce, { authTagLength: CCM_TAG_LENGTH });
    const ciphertext = cipher.update(json, 'utf8');
    cipher.final();
    return Buffer.concat([ciphertext, cipher.getAuthTag(), nonce]);
  }

  unwrapResponse(raw: Buffer): string {
    if (raw.length <= CCM_NONCE_LENGTH + CCM_TAG_LENGTH) {
      throw new Error(`Data too short for CCM (${raw.length} bytes)`);
    }
    const nonce = raw.subarray(raw.length - CCM_NONCE_LENGTH);
    const tag = raw.subarray(raw.length - CCM_NONCE_LENGTH - CCM_TAG_LENGTH, raw.length - CCM_NONCE_LENGTH);
    const ciphertext = raw.subarray(0, raw.length - CCM_NONCE_LENGTH - CCM_TAG_LENGTH);
    const decipher = crypto.createDecipheriv('aes-256-ccm', this.key, nonce, { authTagLength: CCM_TAG_LENGTH });
    decipher.setAuthTag(tag);
    const plain = decipher.update(ciphertext);
    decipher.final();
    return utf8.decode(plain);
  }
}

/** Protocols to probe, in order. CCM is left out when the EUID is not hex. */
export function protocolCandidates(euid: string): GatewayProtocol[] {
  const candidates: GatewayProtocol[] = [
    new AesCbcProtocol(euid),
    new AesCbcProtocol(euid, { aes128: true }),
  ];
  try {
    candidates.push(new AesCcmProtocol(euid));
  } catch {
    // Non-hex EUID: CCM key cannot be derived.
  }
  return candidates;
}

/** Build the protocol with the given name (e.g. one remembered from detection). */
export function createProtocol(name: ProtocolName, euid: string): GatewayProtocol {
  switch (name) {
    case 'aes-256-cbc': return new AesCbcProtocol(euid);
    case 'aes-128-cbc': return new AesCbcProtocol(euid, { aes128: true });
    case 'aes-256-ccm': return new AesCcmProtocol(euid);
    default: throw new Error(`Unknown protocol: ${String(name)}`);
  }
}
