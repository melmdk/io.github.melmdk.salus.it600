'use strict';

import Homey from 'homey';
import type { PairSession } from 'homey/lib/Driver';
import type { SwitchDevice, PairingDeviceData } from '../../lib/device-types';
import { registerGatewayPairing, registerGatewayRepair } from '../../lib/pairing';
import type { SalusAppApi } from '../../lib/pairing';

class SwitchDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.log('Switch driver initialized');
  }

  async onPair(session: PairSession): Promise<void> {
    registerGatewayPairing(session, this.homey.app as Homey.App & SalusAppApi, (gateway) => {
      const switchDevices = gateway.getSwitchDevices();
      const devices: PairingDeviceData[] = [];

      switchDevices.forEach((device: SwitchDevice, uniqueId: string) => {
        devices.push({
          name: device.name,
          data: { id: uniqueId },
          store: { deviceData: device.data },
          capabilities: ['onoff'],
        });
      });

      return devices;
    });
  }

  async onRepair(session: PairSession): Promise<void> {
    registerGatewayRepair(session, this.homey.app as Homey.App & SalusAppApi);
  }
}

module.exports = SwitchDriver;
