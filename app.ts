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
    this.log('Salus IT600 app initialized');
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
