'use strict';

import Homey from 'homey';
import type { IT600Gateway } from '../../lib/salus-api';
import type { WiringCentreDevice as WiringCentreData } from '../../lib/device-types';
import { computeDiagnostics } from '../../lib/diagnostics';

interface SalusIT600App extends Homey.App {
  getGateway(): IT600Gateway | null;
}

class WiringCentreDevice extends Homey.Device {
  private deviceId!: string;
  private updateHandler: (() => void) | null = null;
  private previousProblems: string[] | null = null;

  async onInit(): Promise<void> {
    this.deviceId = this.getData().id as string;
    this.log(`Wiring centre initialized: ${this.getName()} (${this.deviceId})`);

    this.updateHandler = () => {
      this.updateState().catch(this.error);
    };
    this.homey.on('devices_updated', this.updateHandler);

    await this.updateState();
  }

  async onDeleted(): Promise<void> {
    if (this.updateHandler) {
      this.homey.off('devices_updated', this.updateHandler);
    }
    this.log(`Wiring centre deleted: ${this.getName()}`);
  }

  private getDevice(): WiringCentreData | undefined {
    const gateway = (this.homey.app as SalusIT600App).getGateway();
    return gateway ? gateway.getWiringCentreDevice(this.deviceId) : undefined;
  }

  async updateState(): Promise<void> {
    const device = this.getDevice();

    if (!device) {
      this.setUnavailable('Device not found').catch(this.error);
      return;
    }

    if (!device.connected) {
      this.setUnavailable('Device offline').catch(this.error);
      return;
    }

    const updates: Promise<void>[] = [this.setAvailable()];
    const setIfChanged = (key: string, value: unknown): void => {
      if (this.getCapabilityValue(key) !== value) {
        updates.push(this.setCapabilityValue(key, value));
      }
    };

    const diagnostics = computeDiagnostics(this.previousProblems, device.problems);
    this.previousProblems = device.problems;

    setIfChanged('alarm_generic', diagnostics.alarm);
    setIfChanged('salus_problems', diagnostics.text);
    if (device.rssi !== null) setIfChanged('salus_rssi', device.rssi);
    if (device.lqi !== null) setIfChanged('salus_lqi', device.lqi);

    await Promise.all(updates).catch(this.error);

    const trigger = this.homey.flow.getTriggerCard('problem_started');
    for (const problem of diagnostics.newProblems) {
      trigger.trigger({ device: this.getName(), problem }).catch(this.error);
    }
  }
}

module.exports = WiringCentreDevice;
