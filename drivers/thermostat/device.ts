'use strict';

import Homey from 'homey';
import type { IT600Gateway } from '../../lib/salus-api';
import type { ClimateDevice } from '../../lib/device-types';
import type { HvacMode, PresetMode } from '../../lib/constants';

interface SalusIT600App extends Homey.App {
  getGateway(): IT600Gateway | null;
  pollNow(): Promise<void>;
}

class ThermostatDevice extends Homey.Device {
  private deviceId!: string;
  private updateHandler: (() => void) | null = null;

  async onInit(): Promise<void> {
    this.deviceId = this.getData().id as string;
    this.log(`Thermostat device initialized: ${this.getName()} (${this.deviceId})`);

    // Add battery capabilities if missing (for devices paired before this feature)
    if (!this.hasCapability('measure_battery')) {
      await this.addCapability('measure_battery').catch(this.error);
      this.log('Added measure_battery capability');
    }
    if (!this.hasCapability('alarm_battery')) {
      await this.addCapability('alarm_battery').catch(this.error);
      this.log('Added alarm_battery capability');
    }

    // Register capability listeners
    this.registerCapabilityListener('target_temperature', this.onTargetTemperature.bind(this));
    this.registerCapabilityListener('thermostat_mode', this.onThermostatMode.bind(this));

    if (this.hasCapability('salus_preset_mode')) {
      this.registerCapabilityListener('salus_preset_mode', this.onPresetMode.bind(this));
    }

    // Subscribe to device updates
    this.updateHandler = () => this.updateState();
    this.homey.on('devices_updated', this.updateHandler);

    // Initial state update
    await this.updateState();
  }

  async onDeleted(): Promise<void> {
    if (this.updateHandler) {
      this.homey.off('devices_updated', this.updateHandler);
    }
    this.log(`Thermostat device deleted: ${this.getName()}`);
  }

  private getGateway(): IT600Gateway | null {
    const app = this.homey.app as SalusIT600App;
    return app.getGateway();
  }

  private getDevice(): ClimateDevice | undefined {
    const gateway = this.getGateway();
    if (!gateway) return undefined;
    return gateway.getClimateDevice(this.deviceId);
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

    // Only update capabilities whose values have changed
    const updates: Promise<void>[] = [this.setAvailable()];
    const setIfChanged = (key: string, value: unknown): void => {
      if (this.getCapabilityValue(key) !== value) {
        updates.push(this.setCapabilityValue(key, value));
      }
    };

    setIfChanged('measure_temperature', device.currentTemperature);
    setIfChanged('target_temperature', device.targetTemperature);
    setIfChanged('thermostat_mode', device.hvacMode);

    if (this.hasCapability('measure_humidity') && device.currentHumidity !== null) {
      setIfChanged('measure_humidity', device.currentHumidity);
    }

    if (this.hasCapability('measure_battery') && device.batteryLevel !== null) {
      const batteryPercent = Math.round((device.batteryLevel / 5) * 100);
      setIfChanged('measure_battery', batteryPercent);
    }

    if (this.hasCapability('alarm_battery') && device.batteryLevel !== null) {
      setIfChanged('alarm_battery', device.batteryLevel <= 1);
    }

    if (this.hasCapability('salus_preset_mode')) {
      setIfChanged('salus_preset_mode', device.presetMode);
    }

    await Promise.all(updates).catch(this.error);
  }

  async onTargetTemperature(value: number): Promise<void> {
    this.log(`Setting target temperature to ${value}`);

    const gateway = this.getGateway();
    if (!gateway) {
      throw new Error('Gateway not connected');
    }

    await gateway.setClimateTemperature(this.deviceId, value);

    // Poll to get updated state
    const app = this.homey.app as SalusIT600App;
    await app.pollNow();
  }

  async onThermostatMode(value: string): Promise<void> {
    this.log(`Setting thermostat mode to ${value}`);

    const gateway = this.getGateway();
    if (!gateway) {
      throw new Error('Gateway not connected');
    }

    const mode = value as HvacMode;
    await gateway.setClimateMode(this.deviceId, mode);

    // Poll to get updated state
    const app = this.homey.app as SalusIT600App;
    await app.pollNow();
  }

  async onPresetMode(value: string): Promise<void> {
    this.log(`Setting preset mode to ${value}`);

    const gateway = this.getGateway();
    if (!gateway) {
      throw new Error('Gateway not connected');
    }

    const preset = value as PresetMode;
    await gateway.setClimatePreset(this.deviceId, preset);

    // Poll to get updated state
    const app = this.homey.app as SalusIT600App;
    await app.pollNow();
  }
}

module.exports = ThermostatDevice;
