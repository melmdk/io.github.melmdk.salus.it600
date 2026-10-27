import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitiseGatewayPayload } from '../lib/sanitise';
import type { ApiResponse } from '../lib/device-types';

const payload = {
  status: 'success',
  id: [
    {
      data: { UniID: 'abc123', Endpoint: 9 },
      sGateway: {
        NetworkSSID: 'home-wifi',
        NetworkPassword: 'hunter2',
        LocalModeAccessCode: '1234',
        NetworkLANMAC: 'AA:BB:CC:00:00:01',
        NetworkWiFiMAC: 'AA:BB:CC:00:00:02',
        NetworkWiFiIP: '10.0.0.5',
        NetworkLANRouterAddr: '10.0.0.1',
        ModelIdentifier: 'UGE600',
        GatewaySoftwareVersion: '1.2.3',
      },
      sIT600TH: { LocalTemperature_x100: 2100 },
      sZDO: { DeviceName: '{"deviceName":"Living"}' },
    },
  ],
} as unknown as ApiResponse;

test('sanitise removes secrets', () => {
  const out = sanitiseGatewayPayload(payload);
  const gw = out.id?.[0].sGateway as Record<string, string>;
  for (const key of ['NetworkSSID', 'NetworkPassword', 'LocalModeAccessCode', 'NetworkLANMAC',
    'NetworkWiFiMAC', 'NetworkWiFiIP', 'NetworkLANRouterAddr']) {
    assert.equal(gw[key], 'REDACTED', key);
  }
  assert.equal(gw.ModelIdentifier, 'UGE600');
  assert.equal(gw.GatewaySoftwareVersion, '1.2.3');
  assert.equal((payload.id?.[0].sGateway as Record<string, string>).NetworkSSID, 'home-wifi');
});

test('sanitise keeps device data', () => {
  const out = sanitiseGatewayPayload(payload);
  assert.deepEqual(out.id?.[0].data, { UniID: '00000000000000a1', Endpoint: 9 });
  assert.deepEqual(out.id?.[0].sIT600TH, payload.id?.[0].sIT600TH);
  assert.equal(out.id?.[0].sZDO?.DeviceName, '{"deviceName":"Living"}');
});

test('sanitise redacts network and location key classes', () => {
  const gw = {
    OutboundIP: '203.0.113.9', NetworkPriDNS: '10.0.0.1', NetworkSecDNS: '8.8.8.8',
    NetworkLANSubnet: '255.255.255.0', WirelessAPpassword: 'abc', NetworkSSID_f: 'xyz',
    PhoneLocation: '55.1,12.2', ModelIdentifier: 'UGE600',
  };
  const out = sanitiseGatewayPayload({ status: 'success', id: [{ data: {}, sGateway: gw }] } as unknown as ApiResponse);
  const got = out.id?.[0].sGateway as unknown as Record<string, string>;
  for (const key of Object.keys(gw)) {
    assert.equal(got[key], key === 'ModelIdentifier' ? 'UGE600' : 'REDACTED', key);
  }
});

test('sanitise redacts the whole cloud registration block', () => {
  const gw = {
    data: { UniID: 'cccccccccccccccc' },
    sAWSIoT: {
      GWThingName: 'SAU2AG1_GW-AABBCC000001', CloudID: '123456789012', CertARN: 'f'.repeat(64),
      CloudStatus: 1, PairingFlag: 0,
    },
    sGateway: { ModelIdentifier: 'UGE600' },
  };
  const out = sanitiseGatewayPayload({ status: 'success', id: [gw] } as unknown as ApiResponse);
  const got = out.id?.[0] as unknown as { sAWSIoT: Record<string, unknown>; sGateway: Record<string, unknown> };
  assert.deepEqual(Object.keys(got.sAWSIoT), Object.keys(gw.sAWSIoT));
  for (const [key, value] of Object.entries(got.sAWSIoT)) assert.equal(value, 'REDACTED', key);
  assert.equal(got.sGateway.ModelIdentifier, 'UGE600');
});

test('sanitise redacts cloud ids, sun times and debug messages anywhere', () => {
  const gw = {
    SunriseTime_i: '064512', SunsetTime_i: '163401', TimeZone: 'Europe/Copenhagen', DeviceTimeZone_i: 3600,
    GatewayDebugMsg: '[GW Time:2026-10-26 12:00:00,000],something 2026-10-26',
    ZigbeeDebugMsg: '[ZB Time:2026-10-26 12:00:00,00],x', LocalDebugMsg_d: 'Local id: abc',
    GWThingName: 'SAU2AG1_GW-AABBCC000001', CloudID: '123456789012', CertARN: 'abc',
  };
  const out = sanitiseGatewayPayload({ status: 'success', id: [{ data: {}, sOther: gw }] } as unknown as ApiResponse);
  const got = (out.id?.[0] as unknown as { sOther: Record<string, unknown> }).sOther;
  for (const key of Object.keys(gw)) {
    const kept = key === 'TimeZone' || key === 'DeviceTimeZone_i';
    assert.equal(got[key], kept ? gw[key as keyof typeof gw] : 'REDACTED', key);
  }
});

test('sanitise anonymises device ids deterministically and consistently', () => {
  const readall = { status: 'success', id: [
    { data: { UniID: 'aaaaaaaaaaaaaaaa' }, sZDOInfo: { MACAddress: 'aaaaaaaaaaaaaaaa' } },
    { data: { UniID: 'bbbbbbbbbbbbbbbb' }, sZDO: { DeviceName: 'Kitchen' } },
  ] } as unknown as ApiResponse;
  const deviceid = { status: 'success', id: [{ data: { UniID: 'BBBBBBBBBBBBBBBB' } }] } as unknown as ApiResponse;
  const ids = new Map<string, string>();
  const first = sanitiseGatewayPayload(readall, ids);
  const second = sanitiseGatewayPayload(deviceid, ids);
  assert.equal(first.id?.[0].data.UniID, '00000000000000a1');
  assert.equal((first.id?.[0] as unknown as { sZDOInfo: { MACAddress: string } }).sZDOInfo.MACAddress, '00000000000000a1');
  assert.equal(first.id?.[1].data.UniID, '00000000000000a2');
  assert.equal(second.id?.[0].data.UniID, '00000000000000a2');
  assert.equal(first.id?.[1].sZDO?.DeviceName, 'Kitchen');
  assert.deepEqual(sanitiseGatewayPayload(readall), first);
});
