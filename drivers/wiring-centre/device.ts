'use strict';

import Homey from 'homey';
import type { IT600Gateway } from '../../lib/salus-api';
import type { WiringCentreDevice as WiringCentreData } from '../../lib/device-types';
import { computeDiagnostics, fireProblemTriggers } from '../../lib/diagnostics';
import { AvailabilityTracker } from '../../lib/availability';

interface SalusIT600App extends Homey.App {
  getGateway(): IT600Gateway | null;
}

class WiringCentreDevice extends Homey.Device {
  private deviceId!: string;
  private updateHandler: (() => void) | null = null;
  private previousProblems: string[] | null = null;
  private readonly availability = new AvailabilityTracker();

  async onInit(): Promise<void> {
    this.deviceId = this.getData().id as string;
    this.log(`Wiring centre initialized: ${this.getName()} (${this.deviceId})`);

    // Connected indicator (for wiring centres paired before it existed)
    if (!this.hasCapability('salus_connected')) {
      await this.addCapability('salus_connected').catch(this.error);
      this.log('Added salus_connected capability');
    }

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

  /** Record the connected state while the device is still available, so flows see the change. */
  private async setConnected(connected: boolean): Promise<void> {
    if (this.hasCapability('salus_connected') && this.getCapabilityValue('salus_connected') !== connected) {
      await this.setCapabilityValue('salus_connected', connected).catch(this.error);
    }
  }

  /** Set the device available (null) or unavailable with `reason`, only when that changes. */
  private applyAvailability(reason: string | null): Promise<void> {
    return this.availability.update(this, reason).catch(this.error);
  }

  async updateState(): Promise<void> {
    const device = this.getDevice();

    if (!device) {
      await this.setConnected(false);
      await this.applyAvailability('Device not found');
      return;
    }

    if (!device.connected) {
      await this.setConnected(false);
      await this.applyAvailability('Device offline');
      return;
    }

    await this.setConnected(true);
    const updates: Promise<void>[] = [this.applyAvailability(null)];
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

    fireProblemTriggers(this.homey, this.getName(), diagnostics.newProblems, this.error);
  }
}

module.exports = WiringCentreDevice;
