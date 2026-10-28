import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  connectedSettings, connectionErrorMessage, failedConnectSettings, inputCombinedDetails, inputNonce,
  migrateGatewaySettings,
} from '../lib/gateway-settings';
import {
  IT600AuthenticationError,
  IT600CommandError,
  IT600ConnectionError,
  IT600UnreachableError,
  IT600UnsupportedFirmwareError,
} from '../lib/salus-api';

const LEGACY = { host: '192.0.2.10', euid: '0123456789ABCDEF', combinedDetails: true };

test('migrateGatewaySettings accepts legacy shapes', () => {
  const fromGateway = migrateGatewaySettings({ host: '192.0.2.10', euid: '0123 4567 89ab cdef' });
  assert.deepEqual(fromGateway, LEGACY);
  assert.ok(fromGateway && !('protocol' in fromGateway));

  assert.deepEqual(migrateGatewaySettings(null, '192.0.2.10', '0123456789ABCDEF'), LEGACY);
  assert.equal(migrateGatewaySettings(null), null);
});

test('migrateGatewaySettings keeps a known protocol and drops an unknown one', () => {
  assert.deepEqual(
    migrateGatewaySettings({ host: '192.0.2.10', euid: '0123456789ABCDEF', protocol: 'aes-256-ccm' }),
    { ...LEGACY, protocol: 'aes-256-ccm' },
  );
  const unknown = migrateGatewaySettings({ host: '192.0.2.10', euid: '0123456789ABCDEF', protocol: 'rot13' });
  assert.deepEqual(unknown, LEGACY);
  assert.ok(unknown && !('protocol' in unknown));
});

test('migrateGatewaySettings defaults combined details on and keeps an explicit off', () => {
  assert.equal(migrateGatewaySettings({ host: 'h', euid: '0123456789ABCDEF' })?.combinedDetails, true);
  assert.equal(
    migrateGatewaySettings({ host: 'h', euid: '0123456789ABCDEF', combinedDetails: false })?.combinedDetails,
    false,
  );
});

test('migrateGatewaySettings rejects incomplete settings', () => {
  assert.equal(migrateGatewaySettings({ host: '', euid: '0123456789ABCDEF' }), null);
  assert.equal(migrateGatewaySettings({ host: '192.0.2.10', euid: '   ' }), null);
  assert.equal(migrateGatewaySettings('192.0.2.10'), null);
  assert.equal(migrateGatewaySettings(undefined, '192.0.2.10', undefined), null);
  // An incomplete `gateway` setting falls back to the legacy keys.
  assert.deepEqual(migrateGatewaySettings({ host: '192.0.2.10' }, ' 192.0.2.10 ', '0123456789abcdef'), LEGACY);
});

test('connection errors map to user-facing text only', () => {
  assert.equal(
    connectionErrorMessage(new IT600AuthenticationError('Wrong EUID: check the 16 characters on the gateway label')),
    'Wrong EUID: check the 16 characters on the gateway label',
  );
  assert.equal(
    connectionErrorMessage(new IT600UnreachableError('No gateway answering at 10.0.0.9')),
    'No gateway answering at 10.0.0.9',
  );
  // A transport failure on a later request carries raw network text.
  assert.equal(
    connectionErrorMessage(new IT600ConnectionError('Error communicating with gateway: connect EHOSTUNREACH 10.0.0.9:80')),
    'Could not connect to the gateway',
  );
  assert.equal(
    connectionErrorMessage(new IT600UnsupportedFirmwareError("Gateway firmware uses an encryption this app doesn't support")),
    "Gateway firmware uses an encryption this app doesn't support",
  );
  // Internal API errors and raw Node errors never reach the user.
  assert.equal(
    connectionErrorMessage(new IT600CommandError('Gateway response did not contain gateway information')),
    'Could not connect to the gateway',
  );
  assert.equal(connectionErrorMessage(new Error('bad decrypt')), 'Could not connect to the gateway');
  assert.equal(connectionErrorMessage('boom'), 'Could not connect to the gateway');
});

test('connectedSettings reuses the stored protocol only for the same gateway', () => {
  const previous = { host: '10.0.0.1', euid: '0123456789ABCDEF', protocol: 'aes-128-cbc' as const, combinedDetails: false };
  // Same EUID, new IP (the gateway moved VLAN): protocol and preference carry over.
  assert.deepEqual(connectedSettings(previous, '192.0.2.10', '0123456789ABCDEF'), {
    host: '192.0.2.10', euid: '0123456789ABCDEF', protocol: 'aes-128-cbc', combinedDetails: false,
  });
  // A different gateway is probed afresh; first setup gets the default.
  assert.equal(connectedSettings(previous, '10.0.0.1', 'FEDCBA9876543210').protocol, undefined);
  assert.deepEqual(connectedSettings(null, '10.0.0.1', '0123456789ABCDEF'), {
    host: '10.0.0.1', euid: '0123456789ABCDEF', combinedDetails: true,
  });
  // After connecting, the detected protocol is what gets stored.
  assert.equal(connectedSettings(previous, '10.0.0.1', '0123456789ABCDEF', 'aes-256-cbc').protocol, 'aes-256-cbc');
});

test('connectedSettings takes the settings page choice for combined requests', () => {
  const previous = { host: '10.0.0.1', euid: '0123456789ABCDEF', protocol: 'aes-256-cbc' as const, combinedDetails: true };
  assert.equal(connectedSettings(previous, '10.0.0.1', '0123456789ABCDEF', undefined, false).combinedDetails, false);
  assert.equal(connectedSettings(previous, '10.0.0.1', '0123456789ABCDEF', 'aes-256-cbc', false).combinedDetails, false);
  assert.equal(
    connectedSettings({ ...previous, combinedDetails: false }, '10.0.0.1', '0123456789ABCDEF', 'aes-256-cbc', true).combinedDetails,
    true,
  );
  assert.equal(connectedSettings(null, '10.0.0.1', '0123456789ABCDEF', undefined, false).combinedDetails, false);
  // No choice sent (pairing, repair, older settings page): the stored preference stays.
  assert.equal(
    connectedSettings({ ...previous, combinedDetails: false }, '10.0.0.1', '0123456789ABCDEF', 'aes-256-cbc').combinedDetails,
    false,
  );
});

test('inputCombinedDetails reads only an explicit boolean', () => {
  assert.equal(inputCombinedDetails({ host: 'h', euid: 'e', combinedDetails: false }), false);
  assert.equal(inputCombinedDetails({ host: 'h', euid: 'e', combinedDetails: true }), true);
  assert.equal(inputCombinedDetails({ host: 'h', euid: 'e', at: 1 }), undefined);
  assert.equal(inputCombinedDetails({ combinedDetails: 'false' }), undefined);
  assert.equal(inputCombinedDetails(null), undefined);
});

test('failedConnectSettings keeps only a new combined-requests choice', () => {
  const previous = { host: '10.0.0.1', euid: '0123456789ABCDEF', protocol: 'aes-256-cbc' as const, combinedDetails: true };
  assert.deepEqual(failedConnectSettings(previous, false), { ...previous, combinedDetails: false });
  assert.equal(failedConnectSettings(previous, true), null, 'same choice: nothing to write');
  assert.equal(failedConnectSettings(previous, undefined), null, 'no choice sent');
  assert.equal(failedConnectSettings(null, false), null, 'no saved gateway to attach it to');
  assert.deepEqual(previous.combinedDetails, true, 'previous is not modified');
});

test('inputNonce reads only a numeric at', () => {
  assert.equal(inputNonce({ host: 'h', euid: 'e', at: 1712 }), 1712);
  assert.equal(inputNonce({ host: 'h', euid: 'e', at: '1712' }), undefined);
  assert.equal(inputNonce({ host: 'h', euid: 'e' }), undefined);
  assert.equal(inputNonce(null), undefined);
});
