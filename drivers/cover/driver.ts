'use strict';

import Homey from 'homey';
import type { PairSession } from 'homey/lib/Driver';
import type { CoverDevice, PairingDeviceData } from '../../lib/device-types';
import { registerGatewayPairing, registerGatewayRepair } from '../../lib/pairing';
import type { SalusAppApi } from '../../lib/pairing';

class CoverDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.log('Cover driver initialized');
  }

  async onPair(session: PairSession): Promise<void> {
    registerGatewayPairing(session, this.homey.app as Homey.App & SalusAppApi, (gateway) => {
      const coverDevices = gateway.getCoverDevices();
      const devices: PairingDeviceData[] = [];

      coverDevices.forEach((device: CoverDevice, uniqueId: string) => {
        devices.push({
          name: device.name,
          data: { id: uniqueId },
          store: { deviceData: device.data },
          capabilities: ['windowcoverings_state', 'windowcoverings_set'],
        });
      });

      return devices;
    });
  }

  async onRepair(session: PairSession): Promise<void> {
    registerGatewayRepair(session, this.homey.app as Homey.App & SalusAppApi);
  }
}

module.exports = CoverDriver;
