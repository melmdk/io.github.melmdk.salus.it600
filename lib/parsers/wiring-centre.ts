/**
 * Wiring centre (it600WC) parser.
 *
 * Ported from salus-it600-client 0.7.0 (MIT/Apache-2.0), parsers/wiring_centre.py.
 * The it600WC carries only a fault register (`sIT600WC`), identity fields and
 * signal quality, so it is modelled as diagnostics: connected + problems.
 */

import type { ApiDeviceStatus, WiringCentreDevice } from '../device-types';
import { activeErrors, modelOf, parseDeviceName, signalOf } from './common';

// eslint-disable-next-line import/prefer-default-export -- named like every parser, imported by name
export function parseWiringCentre(d: ApiDeviceStatus, previous?: WiringCentreDevice): WiringCentreDevice | null {
  const uniqueId = d.data?.UniID;
  if (!uniqueId) return null;

  const wc = d.sIT600WC;
  const problems = activeErrors(wc);
  // ErrorCodeWC_d is a hex string, "0000" when healthy: only non-zero digits count.
  const errorCode = wc?.ErrorCodeWC_d;
  if (typeof errorCode === 'string' && errorCode.replace(/0/g, '') !== '') {
    problems.push(`Wiring centre error code ${errorCode}`);
  }

  const online = (d.sZDOInfo?.OnlineStatus_i ?? 1) === 1;
  return {
    available: online,
    name: parseDeviceName(d.sZDO?.DeviceName, 'Unknown'),
    uniqueId,
    data: d.data,
    model: modelOf(d),
    connected: online,
    problems,
    ...signalOf(d, previous),
  };
}
