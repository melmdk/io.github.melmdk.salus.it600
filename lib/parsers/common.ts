/**
 * Helpers shared by the device parsers.
 *
 * Ported from salus-it600-client 0.7.0 (MIT/Apache-2.0), parsers/common.py.
 */

import { THERMOSTAT_ERROR_CODES } from '../constants';
import type { ApiDeviceStatus } from '../device-types';

/** Parse device name from the JSON string the gateway stores in `sZDO.DeviceName`. */
export function parseDeviceName(deviceNameJson: string | undefined, fallback: string): string {
  if (!deviceNameJson) return fallback;
  try {
    const parsed = JSON.parse(deviceNameJson) as { deviceName?: string };
    return parsed.deviceName || fallback;
  } catch {
    return fallback;
  }
}

/** Model identifier: `DeviceL.ModelIdentifier_i`, else `sBasicS.ModelIdentifier`. */
export function modelOf(d: ApiDeviceStatus): string | null {
  return d.DeviceL?.ModelIdentifier_i || d.sBasicS?.ModelIdentifier || null;
}

/** Descriptions of the `ErrorNN` flags set to 1 in a fault register block. */
export function activeErrors(block: Record<string, unknown> | undefined): string[] {
  if (!block) return [];
  return Object.entries(THERMOSTAT_ERROR_CODES)
    .filter(([key]) => block[key] === 1)
    .map(([, description]) => description);
}

/**
 * Signal quality from `sIT600I`. The reading is absent from some payloads, so
 * the previous value is kept rather than dropping to null.
 */
export function signalOf(
  d: ApiDeviceStatus,
  previous?: { rssi: number | null; lqi: number | null },
): { rssi: number | null; lqi: number | null } {
  const rssi = d.sIT600I?.LastMessageRSSI_d;
  const lqi = d.sIT600I?.LastMessageLQI_d;
  return {
    rssi: typeof rssi === 'number' ? rssi : previous?.rssi ?? null,
    lqi: typeof lqi === 'number' ? lqi : previous?.lqi ?? null,
  };
}

/** Only the entries of `next` that are not in `previous`. */
export function diffProblems(previous: string[], next: string[]): string[] {
  return next.filter((problem) => !previous.includes(problem));
}
