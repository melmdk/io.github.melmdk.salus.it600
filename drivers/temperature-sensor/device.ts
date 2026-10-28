'use strict';

import Homey from 'homey';
import type { IT600Gateway } from '../../lib/salus-api';
import { AvailabilityTracker } from '../../lib/availability';
import type { SensorDevice } from '../../lib/device-types';

interface SalusIT600App extends Homey.App {
  getGateway(): IT600Gateway | null;
}

class TemperatureSensorDevice extends Homey.Device {
  private deviceId!: string;
  private updateHandler: (() => void) | null = null;
  private readonly availability = new AvailabilityTracker();

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

  /** Set the device available (null) or unavailable with `reason`, only when that changes. */
  private applyAvailability(reason: string | null): Promise<void> {
    return this.availability.update(this, reason).catch(this.error);
  }

  async updateState(): Promise<void> {
    const device = this.getDevice();

    if (!device) {
      await this.applyAvailability('Device not found');
      return;
    }

    if (!device.available) {
      await this.applyAvailability('Device offline');
      return;
    }

    const updates: Promise<void>[] = [this.applyAvailability(null)];
    if (this.getCapabilityValue('measure_temperature') !== device.state) {
      updates.push(this.setCapabilityValue('measure_temperature', device.state));
    }
    await Promise.all(updates).catch(this.error);
  }
}

module.exports = TemperatureSensorDevice;
