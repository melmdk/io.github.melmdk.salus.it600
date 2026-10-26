import type { ApiResponse } from '../../lib/device-types';

/** Keys whose values are network identifiers or credentials (matched anywhere in the tree). */
export const SENSITIVE_KEY = /mac|addr|ip$|_ip|ipaddr|dns|subnet|ssid|password|passwd|accesscode|outbound|location/i;

/** Keys that carry device identifiers; these are anonymised, not redacted. */
export const DEVICE_ID_KEYS = new Set(['UniID', 'UnquieID', 'MACAddress']);

/** Real device id -> dummy id. Share one map across payloads so ids stay consistent. */
export type IdMap = Map<string, string>;

function isSensitive(key: string): boolean {
  return !DEVICE_ID_KEYS.has(key) && SENSITIVE_KEY.test(key);
}

function collectIds(value: unknown, ids: IdMap): void {
  if (Array.isArray(value)) {
    value.forEach((inner) => collectIds(inner, ids));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (DEVICE_ID_KEYS.has(key) && typeof inner === 'string' && inner !== '') {
        const real = inner.toLowerCase();
        if (!ids.has(real)) ids.set(real, `00000000000000${(ids.size + 0xa1).toString(16).padStart(2, '0')}`);
      } else {
        collectIds(inner, ids);
      }
    }
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redact(value: unknown, ids: IdMap): unknown {
  if (Array.isArray(value)) return value.map((inner) => redact(inner, ids));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = isSensitive(key) ? 'REDACTED' : redact(inner, ids);
    }
    return out;
  }
  if (typeof value === 'string') {
    let text = value;
    for (const [real, dummy] of ids) text = text.replace(new RegExp(escapeRegExp(real), 'gi'), dummy);
    return text;
  }
  return value;
}

/**
 * Deep-copy a gateway payload: redact network secrets anywhere in the tree and
 * anonymise device ids (UniID/UnquieID/MACAddress) in order of first appearance.
 * Pass the same `ids` map for every payload of one capture (readall first).
 */
export function sanitiseGatewayPayload(payload: ApiResponse, ids: IdMap = new Map()): ApiResponse {
  collectIds(payload, ids);
  return redact(payload, ids) as ApiResponse;
}
