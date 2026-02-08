'use strict';

import Homey from 'homey';
import type { IT600Gateway } from '../../lib/salus-api';
import type { SwitchDevice } from '../../lib/device-types';

interface SalusIT600App extends Homey.App {
  getGateway(): IT600Gateway | null;
  pollNow(): Promise<void>;
}

class SwitchSalusDevice extends Homey.Device {
  private deviceId!: string;
  private updateHandler: (() => void) | null = null;

  async onInit(): Promise<void> {
    this.deviceId = this.getData().id as string;
    this.log(`Switch initialized: ${this.getName()} (${this.deviceId})`);

    this.registerCapabilityListener('onoff', this.onOnOff.bind(this));

    this.updateHandler = () => this.updateState();
    this.homey.on('devices_updated', this.updateHandler);

    await this.updateState();
  }

  async onDeleted(): Promise<void> {
    if (this.updateHandler) {
      this.homey.off('devices_updated', this.updateHandler);
    }
  }

  private getGateway(): IT600Gateway | null {
    const app = this.homey.app as SalusIT600App;
    return app.getGateway();
  }

  private getDevice(): SwitchDevice | undefined {
    const gateway = this.getGateway();
    if (!gateway) return undefined;
    return gateway.getSwitchDevice(this.deviceId);
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

    const updates: Promise<void>[] = [this.setAvailable()];
    if (this.getCapabilityValue('onoff') !== device.isOn) {
      updates.push(this.setCapabilityValue('onoff', device.isOn));
    }
    await Promise.all(updates).catch(this.error);
  }

  async onOnOff(value: boolean): Promise<void> {
    this.log(`Setting switch to ${value ? 'on' : 'off'}`);

    const gateway = this.getGateway();
    if (!gateway) {
      throw new Error('Gateway not connected');
    }

    if (value) {
      await gateway.turnOnSwitch(this.deviceId);
    } else {
      await gateway.turnOffSwitch(this.deviceId);
    }

    const app = this.homey.app as SalusIT600App;
    await app.pollNow();
  }
}

module.exports = SwitchSalusDevice;
