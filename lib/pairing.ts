/**
 * Pairing and repair shared by every driver. The app owns the one gateway
 * connection; drivers never create gateways themselves.
 *
 * Pair views (driver.compose.json): `gateway_credentials` (login_credentials)
 * → `list_devices` → `add_devices`. Repair views: `gateway_credentials` → `done`.
 * No Homey runtime imports, so the helpers can be tested with a fake session.
 */

import type { IT600Gateway } from './salus-api';
import type { PairingDeviceData } from './device-types';
import { connectionErrorMessage } from './gateway-settings';

/** The part of Homey's PairSession the helpers use; a real PairSession satisfies it. */
export interface GatewayPairSession {
  setHandler(event: string, handler: (data: unknown) => Promise<unknown>): unknown;
  showView(viewId: string): Promise<void>;
}

/** What the helpers need from the app (implemented in app.ts). */
export type SalusAppApi = {
  getGateway(): IT600Gateway | null;
  connectGateway(host: string, euid: string): Promise<IT600Gateway>;
  refreshDevices(): Promise<void>;
  getSavedHost(): string | null;
};

const CREDENTIALS_VIEW = 'gateway_credentials';
const LIST_VIEW = 'list_devices';

function field(data: unknown, key: 'username' | 'password'): string {
  const value = (data as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Handle the login_credentials `login` event: username is the gateway IP,
 * password the EUID. A blank IP falls back to the saved one, because the
 * template cannot be pre-filled. Errors carry user-facing text only.
 */
async function login(app: SalusAppApi, data: unknown): Promise<void> {
  const host = field(data, 'username') || app.getSavedHost() || '';
  if (!host) throw new Error('Enter the gateway IP address');
  try {
    await app.connectGateway(host, field(data, 'password'));
  } catch (err) {
    throw new Error(connectionErrorMessage(err));
  }
}

/** Fresh devices first, then any last-seen device the fresh poll left out. */
function mergeLastSeen(fresh: PairingDeviceData[], lastSeen: PairingDeviceData[]): PairingDeviceData[] {
  const ids = new Set(fresh.map((device) => device.data.id));
  return fresh.concat(lastSeen.filter((device) => !ids.has(device.data.id)));
}

/**
 * Register the pair-session handlers for a driver.
 *
 * - When the app already has a gateway, the credentials view is skipped.
 * - `login` connects (or reconnects) the app-level gateway.
 * - `list_devices` polls afresh and merges with the devices seen before the
 *   poll, so a device that drops out of one poll is still offered.
 *
 * @param listDevices maps the gateway's current devices to pairing entries
 */
export function registerGatewayPairing(
  session: GatewayPairSession,
  app: SalusAppApi,
  listDevices: (gw: IT600Gateway) => PairingDeviceData[],
): void {
  session.setHandler('showView', async (viewId) => {
    if (viewId === CREDENTIALS_VIEW && app.getGateway()) {
      await session.showView(LIST_VIEW);
    }
  });

  session.setHandler('login', async (data) => {
    await login(app, data);
    return true;
  });

  session.setHandler('list_devices', async () => {
    const gateway = app.getGateway();
    if (!gateway) {
      throw new Error(`No gateway answering at ${app.getSavedHost() ?? 'the saved address'}`);
    }
    const lastSeen = listDevices(gateway);
    await app.refreshDevices();
    return mergeLastSeen(listDevices(app.getGateway() ?? gateway), lastSeen);
  });
}

/**
 * Register the repair-session handlers for a driver. Repair always shows the
 * credentials, reconnects the app-level gateway that all devices share, and
 * polls so devices recover at once.
 */
export function registerGatewayRepair(session: GatewayPairSession, app: SalusAppApi): void {
  session.setHandler('login', async (data) => {
    await login(app, data);
    await app.refreshDevices();
    return true;
  });
}
