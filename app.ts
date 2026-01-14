'use strict';

import Homey from 'homey';
import { IT600Gateway } from './lib/salus-api';

interface GatewaySettings {
  host: string;
  euid: string;
}

class SalusIT600App extends Homey.App {
  private gateway: IT600Gateway | null = null;
  private pollInterval: NodeJS.Timeout | null = null;

  /**
   * onInit is called when the app is initialized.
   */
  async onInit(): Promise<void> {
    // Increase max listeners to support many devices (each device listens for updates)
    this.homey.setMaxListeners(50);

    this.log('Salus IT600 app initialized');

    // Restore gateway connection from saved settings
    const settings = this.homey.settings.get('gateway') as GatewaySettings | null;
    if (settings?.host && settings?.euid) {
      // Sync app settings UI with stored gateway settings
      this.homey.settings.set('host', settings.host);
      this.homey.settings.set('euid', settings.euid);

      this.log(`Restoring gateway connection to ${settings.host}`);
      try {
        await this.createGateway(settings.host, settings.euid);
        // Do an immediate poll to get device data before devices initialize
        await this.pollNow();
        this.startPolling();
        this.log('Gateway connection restored successfully');
      } catch (err) {
        this.error('Failed to restore gateway connection:', err);
      }
    }

    // Listen for settings changes from the app settings page
    this.homey.settings.on('set', (key: string) => {
      if (key === 'host' || key === 'euid') {
        this.onSettingsChanged().catch(this.error);
      }
    });
  }

  /**
   * Handle settings changes from the app settings page.
   */
  private async onSettingsChanged(): Promise<void> {
    const host = this.homey.settings.get('host') as string;
    const euid = this.homey.settings.get('euid') as string;

    if (!host || !euid) {
      this.log('Settings incomplete, waiting for both host and euid');
      return;
    }

    // Check if settings actually changed
    const current = this.homey.settings.get('gateway') as GatewaySettings | null;
    if (current?.host === host && current?.euid === euid) {
      return;
    }

    this.log(`Settings changed, reconnecting to gateway at ${host}`);
    try {
      await this.createGateway(host, euid);
      await this.pollNow();
      this.startPolling();
      this.log('Gateway reconnected successfully');
    } catch (err) {
      this.error('Failed to connect to gateway with new settings:', err);
      throw err;
    }
  }

  /**
   * Get or create gateway connection.
   */
  getGateway(): IT600Gateway | null {
    return this.gateway;
  }

  /**
   * Create a new gateway connection.
   */
  async createGateway(host: string, euid: string): Promise<IT600Gateway> {
    // Close existing gateway if any
    if (this.gateway) {
      this.stopPolling();
      this.gateway = null;
    }

    const gateway = new IT600Gateway(euid, host);
    await gateway.connect();

    this.gateway = gateway;

    // Store settings
    await this.homey.settings.set('gateway', { host, euid } as GatewaySettings);

    return gateway;
  }

  /**
   * Start polling for device updates.
   */
  startPolling(intervalMs: number = 30000): void {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
    }

    this.pollInterval = this.homey.setInterval(async () => {
      try {
        if (this.gateway) {
          await this.gateway.pollStatus();
          this.homey.emit('devices_updated');
        }
      } catch (err) {
        this.error('Polling error:', err);
      }
    }, intervalMs);

    this.log(`Started polling every ${intervalMs}ms`);
  }

  /**
   * Stop polling.
   */
  stopPolling(): void {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
      this.pollInterval = null;
      this.log('Stopped polling');
    }
  }

  /**
   * Poll devices immediately.
   */
  async pollNow(): Promise<void> {
    if (this.gateway) {
      await this.gateway.pollStatus();
      this.homey.emit('devices_updated');
    }
  }
}

module.exports = SalusIT600App;
