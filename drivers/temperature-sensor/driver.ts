'use strict';

import Homey from 'homey';
import type { PairSession } from 'homey/lib/Driver';
import type { SensorDevice, PairingDeviceData } from '../../lib/device-types';
import { registerGatewayPairing, registerGatewayRepair } from '../../lib/pairing';
import type { SalusAppApi } from '../../lib/pairing';

class TemperatureSensorDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.log('Temperature sensor driver initialized');
  }

  async onPair(session: PairSession): Promise<void> {
    registerGatewayPairing(session, this.homey.app as Homey.App & SalusAppApi, (gateway) => {
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

  async onRepair(session: PairSession): Promise<void> {
    registerGatewayRepair(session, this.homey.app as Homey.App & SalusAppApi);
  }
}

module.exports = TemperatureSensorDriver;
