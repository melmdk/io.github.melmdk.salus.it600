'use strict';

import Homey from 'homey';
import type { PairSession } from 'homey/lib/Driver';
import type { BinarySensorDevice, PairingDeviceData } from '../../lib/device-types';
import { registerGatewayPairing, registerGatewayRepair } from '../../lib/pairing';
import type { SalusAppApi } from '../../lib/pairing';

class BinarySensorDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.log('Binary sensor driver initialized');
  }

  async onPair(session: PairSession): Promise<void> {
    registerGatewayPairing(session, this.homey.app as Homey.App & SalusAppApi, (gateway) => {
      const binarySensors = gateway.getBinarySensorDevices();
      const devices: PairingDeviceData[] = [];

      binarySensors.forEach((device: BinarySensorDevice, uniqueId: string) => {
        // Determine capability based on device class
        let capability = 'alarm_contact';
        if (device.deviceClass === 'moisture') {
          capability = 'alarm_water';
        } else if (device.deviceClass === 'smoke') {
          capability = 'alarm_smoke';
        }

        devices.push({
          name: device.name,
          data: { id: uniqueId },
          store: { deviceData: device.data },
          capabilities: [capability],
        });
      });

      return devices;
    });
  }

  async onRepair(session: PairSession): Promise<void> {
    registerGatewayRepair(session, this.homey.app as Homey.App & SalusAppApi);
  }
}

module.exports = BinarySensorDriver;
