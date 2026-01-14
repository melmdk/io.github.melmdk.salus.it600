'use strict';

import Homey from 'homey';
import type { IT600Gateway } from '../../lib/salus-api';
import type { SensorDevice } from '../../lib/device-types';

interface SalusIT600App extends Homey.App {
  getGateway(): IT600Gateway | null;
}

class TemperatureSensorDevice extends Homey.Device {
  private deviceId!: string;
  private updateHandler: (() => void) | null = null;

  async onInit(): Promise<void> {
    this.deviceId = this.getData().id as string;
    this.log(`Temperature sensor initialized: ${this.getName()} (${this.deviceId})`);

    this.updateHandler = () => this.updateState();
    this.homey.on('devices_updated', this.updateHandler);

    await this.updateState();
  }

  async onDeleted(): Promise<void> {
    if (this.updateHandler) {
      this.homey.off('devices_updated', this.updateHandler);
    }
  }

  private getDevice(): SensorDevice | undefined {
    const app = this.homey.app as SalusIT600App;
    const gateway = app.getGateway();
    if (!gateway) return undefined;
    return gateway.getSensorDevice(this.deviceId);
  }

  async updateState(): Promise<void> {
    const device = this.getDevice();

    if (!device) {
      this.setUnavailable('Device not found').catch(this.error);
      return;
    }

    if (!device.available) {
      this.setUnavailable('Device offline').catch(this.error);
      return;
    }

    await this.setAvailable().catch(this.error);
    await this.setCapabilityValue('measure_temperature', device.state).catch(this.error);
  }
}

module.exports = TemperatureSensorDevice;
