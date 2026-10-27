'use strict';

import Homey from 'homey';
import { IT600Gateway } from './lib/salus-api';
import { GatewayConnection } from './lib/gateway-connection';
import type { SalusAppApi } from './lib/pairing';

/**
 * Owns the one gateway connection all drivers and devices share. The
 * connection logic (connect queue, reconnects, settings and status) lives in
 * lib/gateway-connection.ts; this class wires it to Homey: settings, logging,
 * the poll timer and the `devices_updated` event.
 */
class SalusIT600App extends Homey.App implements SalusAppApi {
  private connection!: GatewayConnection<IT600Gateway>;
  private pollInterval: NodeJS.Timeout | null = null;

  async onInit(): Promise<void> {
    // Increase max listeners to support many devices (each device listens for updates)
    this.homey.setMaxListeners(50);

    this.log('Salus IT600 app initialized');

    // The connection and every gateway client log through the app.
    const logger = {
      log: (...args: unknown[]) => this.log(...args),
      error: (...args: unknown[]) => this.error(...args),
    };
    this.connection = new GatewayConnection<IT600Gateway>({
      settings: this.homey.settings,
      logger,
      createGateway: ({ host, euid, protocol }) => new IT600Gateway(euid, host, { protocol, logger }),
      onDevicesUpdated: () => this.homey.emit('devices_updated'),
    });
    await this.connection.start();

    // Always start polling — reconnects automatically if gateway is unreachable at startup
    this.startPolling();

    this.homey.settings.on('set', (key: string) => {
      if (key === 'gateway_input') {
        this.connection.applyInput(this.homey.settings.get('gateway_input'))
          .catch((err) => this.error('Applying gateway settings failed:', err));
      }
    });
  }

  getGateway(): IT600Gateway | null {
    return this.connection.getGateway();
  }

  /** IP of the saved gateway, or null before first setup. */
  getSavedHost(): string | null {
    return this.connection.getSavedHost();
  }

  /** Connect (or reconnect) the app-level gateway; see GatewayConnection.connect. */
  async connectGateway(host: string, euid: string, combinedDetails?: boolean): Promise<IT600Gateway> {
    return this.connection.connect(host, euid, combinedDetails);
  }

  /** @deprecated Use connectGateway. */
  async createGateway(host: string, euid: string): Promise<IT600Gateway> {
    return this.connectGateway(host, euid);
  }

  startPolling(intervalMs: number = 30000): void {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
    }

    this.pollInterval = this.homey.setInterval(() => {
      this.connection.pollOnce().catch((err) => this.error('Polling error:', err));
    }, intervalMs);

    this.log(`Polling every ${intervalMs}ms`);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /** Poll the gateway now and tell devices to update. No-op without a gateway. */
  async refreshDevices(): Promise<void> {
    await this.connection.refreshDevices();
  }

  /** Same as refreshDevices; devices call it after a write. */
  async pollNow(): Promise<void> {
    await this.refreshDevices();
  }
}

module.exports = SalusIT600App;
