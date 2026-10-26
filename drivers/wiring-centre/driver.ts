'use strict';

import Homey from 'homey';
import type { PairSession } from 'homey/lib/Driver';
import type { PairingDeviceData, WiringCentreDevice } from '../../lib/device-types';
import { registerGatewayPairing, registerGatewayRepair } from '../../lib/pairing';
import type { SalusAppApi } from '../../lib/pairing';

class WiringCentreDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.log('Wiring centre driver initialized');
  }

  async onPair(session: PairSession): Promise<void> {
    registerGatewayPairing(session, this.homey.app as Homey.App & SalusAppApi, (gateway) => {
      const devices: PairingDeviceData[] = [];

      gateway.getWiringCentreDevices().forEach((device: WiringCentreDevice, uniqueId: string) => {
        devices.push({
          name: device.name,
          data: { id: uniqueId },
          store: { deviceData: device.data },
          capabilities: ['alarm_generic', 'salus_problems', 'salus_rssi', 'salus_lqi'],
        });
      });

      return devices;
    });
  }

  async onRepair(session: PairSession): Promise<void> {
    registerGatewayRepair(session, this.homey.app as Homey.App & SalusAppApi);
  }
}

module.exports = WiringCentreDriver;
