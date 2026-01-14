'use strict';

import Homey from 'homey';
import type { PairSession } from 'homey/lib/Driver';
import type { IT600Gateway } from '../../lib/salus-api';
import type { SensorDevice, PairingDeviceData } from '../../lib/device-types';

interface SalusIT600App extends Homey.App {
  getGateway(): IT600Gateway | null;
  createGateway(host: string, euid: string): Promise<IT600Gateway>;
  startPolling(intervalMs?: number): void;
}

class TemperatureSensorDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.log('Temperature sensor driver initialized');
  }

  async onPair(session: PairSession): Promise<void> {
    let gateway: IT600Gateway | null = null;

    session.setHandler('login', async (data: { username: string; password: string }) => {
      const host = data.username.trim();
      const euid = data.password.trim();

      try {
        const app = this.homey.app as SalusIT600App;
        gateway = await app.createGateway(host, euid);
        await gateway.pollStatus();
        app.startPolling();
        return true;
      } catch (err) {
        this.error('Connection failed:', err);
        throw new Error(err instanceof Error ? err.message : 'Failed to connect');
      }
    });

    session.setHandler('list_devices', async () => {
      if (!gateway) throw new Error('Not connected');

      const sensorDevices = gateway.getSensorDevices();
      const devices: PairingDeviceData[] = [];

      sensorDevices.forEach((device: SensorDevice, uniqueId: string) => {
        devices.push({
          name: device.name,
          data: { id: uniqueId },
          store: { deviceData: device.data },
          capabilities: ['measure_temperature'],
        });
      });

      return devices;
    });
  }
}

module.exports = TemperatureSensorDriver;
