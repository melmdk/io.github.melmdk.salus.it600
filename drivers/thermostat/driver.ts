'use strict';

import Homey from 'homey';
import type { PairSession } from 'homey/lib/Driver';
import type { ClimateDevice, PairingDeviceData } from '../../lib/device-types';
import { registerGatewayPairing, registerGatewayRepair } from '../../lib/pairing';
import type { SalusAppApi } from '../../lib/pairing';

class ThermostatDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.log('Thermostat driver initialized');
  }

  async onPair(session: PairSession): Promise<void> {
    registerGatewayPairing(session, this.homey.app as Homey.App & SalusAppApi, (gateway) => {
      const climateDevices = gateway.getClimateDevices();
      const devices: PairingDeviceData[] = [];

      climateDevices.forEach((device: ClimateDevice, uniqueId: string) => {
        const capabilities = ['target_temperature', 'measure_temperature'];

        // Add humidity capability if supported
        if (device.currentHumidity !== null) {
          capabilities.push('measure_humidity');
        }

        // Add battery capabilities if device has battery
        if (device.batteryLevel !== null) {
          capabilities.push('measure_battery');
          capabilities.push('alarm_battery');
        }

        // Add preset mode capability
        capabilities.push('salus_preset_mode');

        // Add thermostat mode capability
        capabilities.push('thermostat_mode');

        // Diagnostics
        capabilities.push('alarm_generic', 'salus_problems');

        // Build thermostat_mode values based on device's supported modes
        const modeValues: Array<{ id: string; title: { en: string } }> = [];
        if (device.hvacModes.includes('off')) {
          modeValues.push({ id: 'off', title: { en: 'Off' } });
        }
        if (device.hvacModes.includes('heat')) {
          modeValues.push({ id: 'heat', title: { en: 'Heat' } });
        }
        if (device.hvacModes.includes('cool')) {
          modeValues.push({ id: 'cool', title: { en: 'Cool' } });
        }
        if (device.hvacModes.includes('auto')) {
          modeValues.push({ id: 'auto', title: { en: 'Auto' } });
        }

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
            thermostat_mode: {
              values: modeValues,
            },
          },
        });
      });

      return devices;
    });
  }

  async onRepair(session: PairSession): Promise<void> {
    registerGatewayRepair(session, this.homey.app as Homey.App & SalusAppApi);
  }
}

module.exports = ThermostatDriver;
