'use strict';

import Homey from 'homey';
import type { PairSession } from 'homey/lib/Driver';
import type { IT600Gateway } from '../../lib/salus-api';
import type { ClimateDevice, PairingDeviceData } from '../../lib/device-types';

interface SalusIT600App extends Homey.App {
  getGateway(): IT600Gateway | null;
  createGateway(host: string, euid: string): Promise<IT600Gateway>;
  startPolling(intervalMs?: number): void;
  pollNow(): Promise<void>;
}

class ThermostatDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.log('Thermostat driver initialized');
  }

  async onPair(session: PairSession): Promise<void> {
    let gateway: IT600Gateway | null = null;

    session.setHandler('login', async (data: { username: string; password: string }) => {
      const host = data.username.trim();
      const euid = data.password.trim();

      this.log(`Connecting to gateway at ${host}`);

      try {
        const app = this.homey.app as SalusIT600App;
        gateway = await app.createGateway(host, euid);
        await gateway.pollStatus();

        // Start polling
        app.startPolling();

        return true;
      } catch (err) {
        this.error('Connection failed:', err);
        throw new Error(
          err instanceof Error ? err.message : 'Failed to connect to gateway',
        );
      }
    });

    session.setHandler('list_devices', async () => {
      if (!gateway) {
        throw new Error('Not connected to gateway');
      }

      const climateDevices = gateway.getClimateDevices();
      const devices: PairingDeviceData[] = [];

      climateDevices.forEach((device: ClimateDevice, uniqueId: string) => {
        const capabilities = ['target_temperature', 'measure_temperature'];

        // Add humidity capability if supported
        if (device.currentHumidity !== null) {
          capabilities.push('measure_humidity');
        }

        // Add preset mode capability
        capabilities.push('salus_preset_mode');

        // Add thermostat mode capability
        capabilities.push('thermostat_mode');

        devices.push({
          name: device.name,
          data: {
            id: uniqueId,
          },
          store: {
            deviceData: device.data,
          },
          capabilities,
          capabilitiesOptions: {
            target_temperature: {
              min: device.minTemp,
              max: device.maxTemp,
              step: 0.5,
            },
          },
        });
      });

      return devices;
    });
  }

  async onRepair(session: PairSession): Promise<void> {
    session.setHandler('login', async (data: { username: string; password: string }) => {
      const host = data.username.trim();
      const euid = data.password.trim();

      this.log(`Reconnecting to gateway at ${host}`);

      try {
        const app = this.homey.app as SalusIT600App;
        await app.createGateway(host, euid);
        app.startPolling();
        return true;
      } catch (err) {
        this.error('Repair failed:', err);
        throw new Error(
          err instanceof Error ? err.message : 'Failed to connect to gateway',
        );
      }
    });
  }
}

module.exports = ThermostatDriver;
