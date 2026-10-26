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

  async onInit(): Promise<void> {
    // Increase max listeners to support many devices (each device listens for updates)
    this.homey.setMaxListeners(50);

    this.log('Salus IT600 app initialized');

    const settings = this.homey.settings.get('gateway') as GatewaySettings | null;
    if (settings?.host && settings?.euid) {
      this.homey.settings.set('host', settings.host);
      this.homey.settings.set('euid', settings.euid);

      this.log(`Connecting to gateway at ${settings.host}`);
      try {
        await this.createGateway(settings.host, settings.euid);
        await this.pollNow();
      } catch (err) {
        this.error('Initial gateway connection failed, will retry via polling:', err);
      }
    }

    // Always start polling — reconnects automatically if gateway is unreachable at startup
    this.startPolling();

    this.homey.settings.on('set', (key: string) => {
      if (key === 'host' || key === 'euid') {
        this.onSettingsChanged().catch(this.error);
      }
    });
  }

  private async onSettingsChanged(): Promise<void> {
    const host = this.homey.settings.get('host') as string;
    const euid = this.homey.settings.get('euid') as string;

    if (!host || !euid) return;

    const current = this.homey.settings.get('gateway') as GatewaySettings | null;
    if (current?.host === host && current?.euid === euid) return;

    this.log(`Settings changed, reconnecting to gateway at ${host}`);
    try {
      await this.createGateway(host, euid);
      await this.pollNow();
      this.log('Gateway reconnected successfully');
    } catch (err) {
      this.error('Failed to connect with new settings:', err);
    }
  }

  getGateway(): IT600Gateway | null {
    return this.gateway;
  }

  async createGateway(host: string, euid: string): Promise<IT600Gateway> {
    if (this.gateway) {
      this.gateway = null;
    }

    const gateway = new IT600Gateway(euid, host);
    await gateway.connect();

    this.gateway = gateway;
    await this.homey.settings.set('gateway', { host, euid } as GatewaySettings);

    return gateway;
  }

  startPolling(intervalMs: number = 30000): void {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
    }

    this.pollInterval = this.homey.setInterval(async () => {
      try {
        if (!this.gateway) {
          const settings = this.homey.settings.get('gateway') as GatewaySettings | null;
          if (!settings?.host || !settings?.euid) return;

          this.log('Gateway offline, attempting reconnect...');
          const gateway = new IT600Gateway(settings.euid, settings.host);
          await gateway.connect();
          this.gateway = gateway;
          this.log('Gateway reconnected');
        }

        await this.gateway.pollStatus();
        this.homey.emit('devices_updated');
      } catch (err) {
        this.error('Polling error:', err);
        this.gateway = null;
      }
    }, intervalMs);

    this.log(`Polling every ${intervalMs}ms`);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async pollNow(): Promise<void> {
    if (this.gateway) {
      await this.gateway.pollStatus();
      this.homey.emit('devices_updated');
    }
  }
}

module.exports = SalusIT600App;
