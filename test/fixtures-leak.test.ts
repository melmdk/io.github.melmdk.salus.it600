import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { SENSITIVE_KEY, SENSITIVE_BLOCK, DEVICE_ID_KEYS } from '../lib/sanitise';

const root = path.resolve(__dirname, '../..');
const dir = path.join(root, 'test/fixtures');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

/** Salus Industries' MAC prefix: gateway MACs, EUIDs and cloud thing names start with it. */
const SALUS_OUI = /001e5e/i;
/** A whole value that looks like a MAC (12 hex) or an EUID/device id (16 hex). */
const HEX_ID = /^(?:[0-9a-f]{12}|[0-9a-f]{16})$/i;
const DUMMY_DEVICE_ID = /^00000000000000[0-9a-f]{2}$/;
/** 12/16-hex values that are not identifiers: the dummy test EUIDs and the synthetic CCM nonce of the vectors. */
const ALLOWED_HEX_VALUES = new Set(['0123456789ABCDEF', '0123456789AB', 'a1b2c30001765432']);
/** Keys whose 12-digit value is a firmware version, not an identifier. */
const ALLOWED_HEX_KEYS = new Set(['GatewaySoftwareVersion']);

function walk(value: unknown, visit: (key: string | null, v: unknown) => void, key: string | null = null): void {
  visit(key, value);
  if (Array.isArray(value)) value.forEach((inner) => walk(inner, visit, key));
  else if (value !== null && typeof value === 'object') {
    for (const [k, inner] of Object.entries(value)) walk(inner, visit, k);
  }
}

/** The EUID of the gateway the fixtures were captured from, when test-config.json is present. */
function configuredEuid(): string | null {
  try {
    const { euid } = JSON.parse(fs.readFileSync(path.join(root, 'test-config.json'), 'utf8')) as { euid?: string };
    return euid ? euid.replace(/\s/g, '').toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Assert that a sanitised payload leaks nothing: no IPv4 text, device ids
 * replaced by dummies, every value under a sensitive key `REDACTED` (strings,
 * numbers and booleans alike) and every leaf of a sensitive block `REDACTED`.
 */
function assertRedacted(json: unknown): void {
  walk(json, (key, value) => {
    if (typeof value === 'string') {
      assert.doesNotMatch(value, /\b\d{1,3}(\.\d{1,3}){3}\b/, `IPv4 in ${key}`);
      if (key && DEVICE_ID_KEYS.has(key)) assert.match(value, /^00000000000000[0-9a-f]{2}$/, key);
    }
    if (key && !DEVICE_ID_KEYS.has(key) && SENSITIVE_KEY.test(key)) assert.equal(value, 'REDACTED', key);
    if (key && SENSITIVE_BLOCK.test(key)) {
      walk(value, (inner, leaf) => {
        if (leaf === null || typeof leaf !== 'object') assert.equal(leaf, 'REDACTED', `${key}.${inner}`);
      }, key);
    }
  });
}

test('fixtures exist', () => assert.ok(files.length >= 2));

test('the leak check catches non-string values under sensitive keys', () => {
  for (const leaked of [123456, true, false, 0]) {
    const payload = { id: [{ sGateway: { NetworkLANMAC: 'REDACTED', LocalModeAccessCode: leaked } }] };
    assert.throws(() => assertRedacted(payload), /LocalModeAccessCode/, String(leaked));
  }
  assert.doesNotThrow(() => assertRedacted({ id: [{ sGateway: { LocalModeAccessCode: 'REDACTED', ModelIdentifier: 'UGE600' } }] }));
});

for (const file of files) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const json: unknown = JSON.parse(text);

  test(`fixture ${file} has no leaked identifiers`, () => assertRedacted(json));

  test(`fixture ${file} has no MAC, EUID or cloud id values`, () => {
    walk(json, (key, value) => {
      if (typeof value !== 'string') return;
      // Messages name the key only: the value is what must not end up in logs.
      assert.ok(!SALUS_OUI.test(value), `Salus MAC prefix in ${key}`);
      assert.ok(!/\b[0-9a-f]{2}([:-][0-9a-f]{2}){5}\b/i.test(value), `MAC address in ${key}`);
      const allowed = DUMMY_DEVICE_ID.test(value) || ALLOWED_HEX_VALUES.has(value) || (key !== null && ALLOWED_HEX_KEYS.has(key));
      assert.ok(allowed || !HEX_ID.test(value), `12/16-hex identifier in ${key}`);
    });
  });

  test(`fixture ${file} does not contain the configured EUID`, (t) => {
    const euid = configuredEuid();
    if (!euid) {
      t.skip('no test-config.json');
      return;
    }
    assert.ok(!text.toLowerCase().includes(euid), 'configured EUID found');
  });
}
