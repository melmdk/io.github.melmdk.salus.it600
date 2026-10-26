import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { SENSITIVE_KEY, DEVICE_ID_KEYS } from './helpers/sanitise';

const dir = path.resolve(__dirname, '../../test/fixtures');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

function walk(value: unknown, visit: (key: string | null, v: unknown) => void, key: string | null = null): void {
  visit(key, value);
  if (Array.isArray(value)) value.forEach((inner) => walk(inner, visit, key));
  else if (value !== null && typeof value === 'object') {
    for (const [k, inner] of Object.entries(value)) walk(inner, visit, k);
  }
}

test('fixtures exist', () => assert.ok(files.length >= 2));

for (const file of files) {
  test(`fixture ${file} has no leaked identifiers`, () => {
    const json: unknown = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    walk(json, (key, value) => {
      if (typeof value === 'string') {
        assert.doesNotMatch(value, /\b\d{1,3}(\.\d{1,3}){3}\b/, `IPv4 in ${key}`);
        if (key && DEVICE_ID_KEYS.has(key)) assert.match(value, /^00000000000000[0-9a-f]{2}$/, key);
        else if (key && SENSITIVE_KEY.test(key)) assert.equal(value, 'REDACTED', key);
      }
    });
  });
}
