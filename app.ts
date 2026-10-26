'use strict';

import Homey from 'homey';
import { IT600Gateway } from './lib/salus-api';
import { connectedSettings, connectionErrorMessage, migrateGatewaySettings } from './lib/gateway-settings';
import type { GatewaySettings, GatewayStatus } from './lib/gateway-settings';
import type { ProtocolName } from './lib/protocol';
import type { SalusAppApi } from './lib/pairing';

/**
 * Owns the one gateway connection all drivers and devices share. Settings:
 * `gateway` (persisted connection), `gateway_input` (written by the settings
 * page: host, EUID and an `at` nonce that is not read) and `gateway_status`
 * (outcome of the last connect, user-facing text only; never the EUID).
 */
class SalusIT600App extends Homey.App implements SalusAppApi {
  private gateway: IT600Gateway | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  /** Connects run one at a time, so two gateway instances never race each other. */
  private connectQueue: Promise<unknown> = Promise.resolve();
  private pendingConnects = 0;

  async onInit(): Promise<void> {
    // Increase max listeners to support many devices (each device listens for updates)
    this.homey.setMaxListeners(50);

    this.log('Salus IT600 app initialized');

    const settings = this.loadSettings();
    if (settings) {
      // Store older versions' settings in the current shape.
      if (JSON.stringify(this.homey.settings.get('gateway')) !== JSON.stringify(settings)) {
        this.homey.settings.set('gateway', settings);
      }

      this.log(`Connecting to gateway at ${settings.host}`);
      try {
        await this.connectGateway(settings.host, settings.euid);
        await this.refreshDevices();
      } catch (err) {
        this.error('Initial gateway connection failed, will retry via polling:', err);
      }
    }

    // Always start polling — reconnects automatically if gateway is unreachable at startup
    this.startPolling();

    this.homey.settings.on('set', (key: string) => {
      if (key === 'gateway_input') {
        this.onGatewayInput().catch((err) => this.error('Applying gateway settings failed:', err));
      }
    });
  }

  /** The settings page saved IP and EUID as one change: reconnect once with the pair. */
  private async onGatewayInput(): Promise<void> {
    // Same validation and normalisation as stored settings.
    const input = migrateGatewaySettings(this.homey.settings.get('gateway_input'));
    if (!input) {
      this.error('Ignoring incomplete gateway settings from the settings page');
      return;
    }

    this.log(`Gateway settings changed, connecting to ${input.host}`);
    try {
      await this.connectGateway(input.host, input.euid);
      await this.refreshDevices();
      this.log('Gateway reconnected with new settings');
    } catch (err) {
      this.error('Failed to connect with new gateway settings:', err);
    }
  }

  private loadSettings(): GatewaySettings | null {
    return migrateGatewaySettings(
      this.homey.settings.get('gateway'),
      this.homey.settings.get('host'),
      this.homey.settings.get('euid'),
    );
  }

  getGateway(): IT600Gateway | null {
    return this.gateway;
  }

  /** IP of the saved gateway, or null before first setup. */
  getSavedHost(): string | null {
    return this.loadSettings()?.host ?? null;
  }

  /**
   * Connect (or reconnect) the app-level gateway. Normalises the EUID, tries
   * the stored protocol first (connect() re-detects if it fails), persists
   * `{host, euid, protocol, combinedDetails}` and writes `gateway_status`.
   * On failure the API error is thrown and the previous gateway stays in use.
   */
  async connectGateway(host: string, euid: string): Promise<IT600Gateway> {
    return this.queueConnect(host, euid, true);
  }

  /** @deprecated Use connectGateway. */
  async createGateway(host: string, euid: string): Promise<IT600Gateway> {
    return this.connectGateway(host, euid);
  }

  private queueConnect(host: string, euid: string, alwaysReport: boolean): Promise<IT600Gateway> {
    this.pendingConnects += 1;
    const run = this.connectQueue.then(() => this.openGateway(host, euid, alwaysReport));
    this.connectQueue = run.catch(() => undefined);
    return run.finally(() => {
      this.pendingConnects -= 1;
    });
  }

  private async openGateway(host: string, euid: string, alwaysReport: boolean): Promise<IT600Gateway> {
    const previous = this.loadSettings();
    const attempt = connectedSettings(previous, host, euid);
    const gateway = new IT600Gateway(attempt.euid, attempt.host, { protocol: attempt.protocol });

    let detected: ProtocolName;
    try {
      ({ protocol: detected } = await gateway.connect());
    } catch (err) {
      // Pairing and repair have no logger of their own; the poll loop logs its own failures.
      if (alwaysReport) this.error(`Connecting to gateway at ${attempt.host} failed:`, err);
      this.writeStatus(false, connectionErrorMessage(err), alwaysReport);
      throw err;
    }

    const settings = connectedSettings(previous, attempt.host, attempt.euid, detected);
    // The in-session fallback (rejected / left out / dropped) is never persisted.
    gateway.setCombinedDetailRequests(settings.combinedDetails !== false);
    this.gateway = gateway;
    this.homey.settings.set('gateway', settings);
    this.writeStatus(true, `Connected to ${settings.host}`, alwaysReport);
    this.log(`Connected to gateway at ${settings.host} (${detected}, combined detail requests ${settings.combinedDetails ? 'on' : 'off'})`);
    return gateway;
  }

  /** Write `gateway_status`; background reconnects only write when the outcome changes. */
  private writeStatus(ok: boolean, message: string, always: boolean): void {
    const current = this.homey.settings.get('gateway_status') as GatewayStatus | null;
    if (!always && current?.ok === ok && current?.message === message) return;
    const status: GatewayStatus = { ok, message, at: new Date().toISOString() };
    this.homey.settings.set('gateway_status', status);
  }

  startPolling(intervalMs: number = 30000): void {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
    }

    this.pollInterval = this.homey.setInterval(() => {
      this.pollOnce().catch((err) => this.error('Polling error:', err));
    }, intervalMs);

    this.log(`Polling every ${intervalMs}ms`);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async pollOnce(): Promise<void> {
    // A connect in progress is replacing the gateway; the next tick polls it.
    if (this.pendingConnects > 0) return;

    let polled: IT600Gateway | null = null;
    try {
      if (!this.gateway) {
        const settings = this.loadSettings();
        if (!settings) return;

        this.log(`Gateway offline, attempting reconnect to ${settings.host}...`);
        // Same path as connectGateway: stored protocol first, re-detect on failure.
        await this.queueConnect(settings.host, settings.euid, false);
        this.log('Gateway reconnected');
      }

      polled = this.gateway;
      await this.refreshDevices();
    } catch (err) {
      this.error('Polling error:', err);
      // Drop the gateway so the next tick reconnects, unless a connect replaced it meanwhile.
      if (this.gateway === polled) this.gateway = null;
    }
  }

  /** Poll the gateway now and tell devices to update. No-op without a gateway. */
  async refreshDevices(): Promise<void> {
    const { gateway } = this;
    if (!gateway) return;
    await gateway.pollStatus();
    this.homey.emit('devices_updated');
  }

  /** Same as refreshDevices; devices call it after a write. */
  async pollNow(): Promise<void> {
    await this.refreshDevices();
  }
}

module.exports = SalusIT600App;
