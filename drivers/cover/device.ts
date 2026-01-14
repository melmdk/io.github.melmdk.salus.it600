'use strict';

import Homey from 'homey';
import type { IT600Gateway } from '../../lib/salus-api';
import type { CoverDevice } from '../../lib/device-types';

interface SalusIT600App extends Homey.App {
  getGateway(): IT600Gateway | null;
  pollNow(): Promise<void>;
}

class CoverSalusDevice extends Homey.Device {
  private deviceId!: string;
  private updateHandler: (() => void) | null = null;

  async onInit(): Promise<void> {
    this.deviceId = this.getData().id as string;
    this.log(`Cover initialized: ${this.getName()} (${this.deviceId})`);

    this.registerCapabilityListener('windowcoverings_state', this.onWindowCoveringsState.bind(this));
    this.registerCapabilityListener('windowcoverings_set', this.onWindowCoveringsSet.bind(this));

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

  private getDevice(): CoverDevice | undefined {
    const gateway = this.getGateway();
    if (!gateway) return undefined;
    return gateway.getCoverDevice(this.deviceId);
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

    // Update position (0-1 scale for Homey, 0-100 from device)
    if (device.currentPosition !== null) {
      await this.setCapabilityValue('windowcoverings_set', device.currentPosition / 100)
        .catch(this.error);
    }

    // Update state
    let state: string = 'idle';
    if (device.isOpening) {
      state = 'up';
    } else if (device.isClosing) {
      state = 'down';
    }
    await this.setCapabilityValue('windowcoverings_state', state).catch(this.error);
  }

  async onWindowCoveringsState(value: string): Promise<void> {
    this.log(`Setting cover state to ${value}`);

    const gateway = this.getGateway();
    if (!gateway) {
      throw new Error('Gateway not connected');
    }

    if (value === 'up') {
      await gateway.openCover(this.deviceId);
    } else if (value === 'down') {
      await gateway.closeCover(this.deviceId);
    }
    // 'idle' doesn't need to send a command

    const app = this.homey.app as SalusIT600App;
    await app.pollNow();
  }

  async onWindowCoveringsSet(value: number): Promise<void> {
    // Homey uses 0-1 scale, device uses 0-100
    const position = Math.round(value * 100);
    this.log(`Setting cover position to ${position}%`);

    const gateway = this.getGateway();
    if (!gateway) {
      throw new Error('Gateway not connected');
    }

    await gateway.setCoverPosition(this.deviceId, position);

    const app = this.homey.app as SalusIT600App;
    await app.pollNow();
  }
}

module.exports = CoverSalusDevice;
