'use strict';

import Homey from 'homey';
import type { IT600Gateway } from '../../lib/salus-api';
import type { BinarySensorDevice } from '../../lib/device-types';

interface SalusIT600App extends Homey.App {
  getGateway(): IT600Gateway | null;
}

class BinarySensorSalusDevice extends Homey.Device {
  private deviceId!: string;
  private updateHandler: (() => void) | null = null;

  async onInit(): Promise<void> {
    this.deviceId = this.getData().id as string;
    this.log(`Binary sensor initialized: ${this.getName()} (${this.deviceId})`);

    this.updateHandler = () => this.updateState();
    this.homey.on('devices_updated', this.updateHandler);

    await this.updateState();
  }

  async onDeleted(): Promise<void> {
    if (this.updateHandler) {
      this.homey.off('devices_updated', this.updateHandler);
    }
  }

  private getDevice(): BinarySensorDevice | undefined {
    const app = this.homey.app as SalusIT600App;
    const gateway = app.getGateway();
    if (!gateway) return undefined;
    return gateway.getBinarySensorDevice(this.deviceId);
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

    // Update the appropriate alarm capability
    if (this.hasCapability('alarm_contact')) {
      await this.setCapabilityValue('alarm_contact', device.isOn).catch(this.error);
    }
    if (this.hasCapability('alarm_water')) {
      await this.setCapabilityValue('alarm_water', device.isOn).catch(this.error);
    }
    if (this.hasCapability('alarm_smoke')) {
      await this.setCapabilityValue('alarm_smoke', device.isOn).catch(this.error);
    }
  }
}

module.exports = BinarySensorSalusDevice;
