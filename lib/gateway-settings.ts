/**
 * App-level gateway settings: the persisted shape, migration from older app
 * versions, and the user-facing text for a failed connection. Pure functions,
 * no Homey runtime, so they can be unit tested.
 */

import { normaliseEuid } from './protocol';
import type { ProtocolName } from './protocol';
import {
  IT600AuthenticationError,
  IT600ConnectionError,
  IT600UnsupportedFirmwareError,
} from './salus-api';

/** Persisted under the `gateway` setting. */
export interface GatewaySettings {
  host: string;
  euid: string;
  /** Protocol detected on the last successful connect; skips probing on restart. */
  protocol?: ProtocolName;
  /** Fetch device details in one combined request (falls back per type for the session). */
  combinedDetails?: boolean;
}

/** Written by the settings page under `gateway_input`, as one change. */
export interface GatewayInput {
  host: string;
  euid: string;
}

/** Written by the app under `gateway_status`. Never contains the EUID. */
export interface GatewayStatus {
  ok: boolean;
  message: string;
  at: string;
}

const KNOWN_PROTOCOLS: readonly ProtocolName[] = ['aes-256-cbc', 'aes-128-cbc', 'aes-256-ccm'];

/**
 * Combined detail requests passed the live write-then-read check on the
 * owner's gateway (plan ruling R15), so they are on unless switched off.
 */
const DEFAULT_COMBINED_DETAILS = true;

const GENERIC_CONNECTION_ERROR = 'Could not connect to the gateway';

function cleanHost(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanEuid(value: unknown): string | null {
  return typeof value === 'string' && normaliseEuid(value) ? normaliseEuid(value) : null;
}

/**
 * Read the gateway settings, accepting every shape older versions stored:
 * the `gateway` object (v0.9.x: `{host, euid}`) or the separate legacy
 * `host` / `euid` keys. The EUID is normalised, an unknown protocol is
 * dropped and `combinedDetails` gets its default. Returns null when no
 * complete host + EUID pair exists.
 */
export function migrateGatewaySettings(
  raw: unknown,
  legacyHost?: unknown,
  legacyEuid?: unknown,
): GatewaySettings | null {
  const stored = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let host = cleanHost(stored.host);
  let euid = cleanEuid(stored.euid);
  if (!host || !euid) {
    host = cleanHost(legacyHost);
    euid = cleanEuid(legacyEuid);
  }
  if (!host || !euid) return null;

  const settings: GatewaySettings = { host, euid };
  if (KNOWN_PROTOCOLS.includes(stored.protocol as ProtocolName)) {
    settings.protocol = stored.protocol as ProtocolName;
  }
  settings.combinedDetails = typeof stored.combinedDetails === 'boolean'
    ? stored.combinedDetails
    : DEFAULT_COMBINED_DETAILS;
  return settings;
}

/**
 * Settings for connecting to `host` / `euid` (raw user input is fine).
 * Without `protocol` it returns what to try: the stored protocol is reused
 * only for the same gateway (same EUID; a new IP alone keeps it). With the
 * `protocol` that connect() detected it returns what to persist. The combined
 * details preference carries over; first setup gets the default.
 */
export function connectedSettings(
  previous: GatewaySettings | null,
  host: string,
  euid: string,
  protocol?: ProtocolName,
): GatewaySettings {
  const settings: GatewaySettings = { host: host.trim(), euid: normaliseEuid(euid) };
  const known = protocol ?? (previous?.euid === settings.euid ? previous.protocol : undefined);
  if (known) settings.protocol = known;
  settings.combinedDetails = previous?.combinedDetails ?? DEFAULT_COMBINED_DETAILS;
  return settings;
}

/** Errors whose message is written for users and never contains the EUID. */
const USER_FACING_ERRORS = [IT600ConnectionError, IT600AuthenticationError, IT600UnsupportedFirmwareError];

/**
 * Text to show the user for a failed connect: `No gateway answering at <ip>`,
 * `Wrong EUID: …` or the unsupported-firmware text. Anything else, such as an
 * internal API error or a raw Node `bad decrypt`, becomes a generic line.
 */
export function connectionErrorMessage(err: unknown): string {
  return USER_FACING_ERRORS.some((type) => err instanceof type) ? (err as Error).message : GENERIC_CONNECTION_ERROR;
}
