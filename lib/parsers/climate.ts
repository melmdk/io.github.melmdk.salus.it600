/**
 * Climate (thermostat) parser.
 *
 * Ported from salus-it600-client 0.7.0 (MIT/Apache-2.0), parsers/climate.py.
 */

import {
  TEMP_CELSIUS,
  SUPPORT_TARGET_TEMPERATURE,
  SUPPORT_PRESET_MODE,
  SUPPORT_FAN_MODE,
  HVAC_MODE_OFF,
  HVAC_MODE_HEAT,
  HVAC_MODE_COOL,
  HVAC_MODE_AUTO,
  CURRENT_HVAC_OFF,
  CURRENT_HVAC_HEAT,
  CURRENT_HVAC_HEAT_IDLE,
  CURRENT_HVAC_COOL,
  CURRENT_HVAC_COOL_IDLE,
  CURRENT_HVAC_IDLE,
  PRESET_FOLLOW_SCHEDULE,
  PRESET_PERMANENT_HOLD,
  PRESET_TEMPORARY_HOLD,
  PRESET_ECO,
  PRESET_OFF,
  PRESET_AWAY,
  FAN_MODE_AUTO,
  FAN_MODE_HIGH,
  FAN_MODE_MEDIUM,
  FAN_MODE_LOW,
  FAN_MODE_OFF,
  FanMode,
} from '../constants';
import type { ApiDeviceStatus, ClimateDevice } from '../device-types';
import { activeErrors, modelOf, parseDeviceName, signalOf } from './common';

/** Parse one thermostat payload; null when it is not a thermostat or has no UniID. */
export function parseClimateDevice(device: ApiDeviceStatus, previous?: ClimateDevice): ClimateDevice | null {
  const uniqueId = device.data?.UniID;
  if (!uniqueId) return null;

  const model = modelOf(device);
  const th = device.sIT600TH;
  const ther = device.sTherS;
  const scomm = device.sComm;
  const sfans = device.sFanS;

  const baseProps = {
    available: (device.sZDOInfo?.OnlineStatus_i ?? 1) === 1,
    name: parseDeviceName(device.sZDO?.DeviceName, 'Unknown'),
    uniqueId,
    temperatureUnit: TEMP_CELSIUS,
    precision: 0.1,
    data: device.data,
    manufacturer: device.sBasicS?.ManufactureName || 'SALUS',
    model,
    swVersion: device.sZDO?.FirmwareVersion || null,
  };
  const extras = {
    ...signalOf(device, previous),
    problems: activeErrors(th ?? ther),
  };

  let climateDevice: ClimateDevice;

  if (th) {
    // Standard thermostat (IT600TH)
    let currentHumidity: number | null = null;
    if (model && model.includes('SQ610')) {
      currentHumidity = th.SunnySetpoint_x100 ?? null;
    }

    const holdType = th.HoldType;
    const runningState = th.RunningState;

    climateDevice = {
      ...baseProps,
      currentHumidity,
      batteryLevel: th.BatteryLevel ?? null,
      currentTemperature: th.LocalTemperature_x100 / 100,
      targetTemperature: th.HeatingSetpoint_x100 / 100,
      maxTemp: (th.MaxHeatSetpoint_x100 ?? 3500) / 100,
      minTemp: (th.MinHeatSetpoint_x100 ?? 500) / 100,
      hvacMode: holdType === 7 ? HVAC_MODE_OFF : holdType === 2 ? HVAC_MODE_HEAT : HVAC_MODE_AUTO,
      hvacAction: holdType === 7 ? CURRENT_HVAC_OFF : runningState % 2 === 0 ? CURRENT_HVAC_IDLE : CURRENT_HVAC_HEAT,
      hvacModes: [HVAC_MODE_OFF, HVAC_MODE_HEAT, HVAC_MODE_AUTO],
      presetMode: holdType === 7 ? PRESET_OFF
        : holdType === 2 ? PRESET_PERMANENT_HOLD
        : holdType === 6 ? PRESET_AWAY
        : PRESET_FOLLOW_SCHEDULE,
      presetModes: [PRESET_FOLLOW_SCHEDULE, PRESET_PERMANENT_HOLD, PRESET_OFF, PRESET_AWAY],
      fanMode: null,
      fanModes: null,
      locked: null,
      supportedFeatures: SUPPORT_TARGET_TEMPERATURE | SUPPORT_PRESET_MODE,
      ...extras,
    };
  } else if (ther && scomm && sfans) {
    // FC600 cooling thermostat
    const isHeating = ther.SystemMode === 4;
    const fanModeValue = sfans.FanMode ?? 5;
    const holdType = scomm.HoldType;
    const runningState = ther.RunningState;

    let hvacAction: string;
    if (holdType === 7) {
      hvacAction = CURRENT_HVAC_OFF;
    } else if (runningState === 0) {
      hvacAction = CURRENT_HVAC_IDLE;
    } else if (isHeating && runningState === 33) {
      hvacAction = CURRENT_HVAC_HEAT;
    } else if (isHeating) {
      hvacAction = CURRENT_HVAC_HEAT_IDLE;
    } else if (runningState === 66) {
      hvacAction = CURRENT_HVAC_COOL;
    } else {
      hvacAction = CURRENT_HVAC_COOL_IDLE;
    }

    let fanMode: FanMode;
    if (fanModeValue === 0) fanMode = FAN_MODE_OFF;
    else if (fanModeValue === 3) fanMode = FAN_MODE_HIGH;
    else if (fanModeValue === 2) fanMode = FAN_MODE_MEDIUM;
    else if (fanModeValue === 1) fanMode = FAN_MODE_LOW;
    else fanMode = FAN_MODE_AUTO;

    climateDevice = {
      ...baseProps,
      currentHumidity: null,
      batteryLevel: null, // FC600 is typically wired
      currentTemperature: ther.LocalTemperature_x100 / 100,
      targetTemperature: isHeating
        ? ther.HeatingSetpoint_x100 / 100
        : ther.CoolingSetpoint_x100 / 100,
      maxTemp: isHeating
        ? (ther.MaxHeatSetpoint_x100 ?? 4000) / 100
        : (ther.MaxCoolSetpoint_x100 ?? 4000) / 100,
      minTemp: isHeating
        ? (ther.MinHeatSetpoint_x100 ?? 500) / 100
        : (ther.MinCoolSetpoint_x100 ?? 500) / 100,
      hvacMode: ther.SystemMode === 4 ? HVAC_MODE_HEAT : ther.SystemMode === 3 ? HVAC_MODE_COOL : HVAC_MODE_AUTO,
      hvacAction: hvacAction as typeof CURRENT_HVAC_OFF,
      hvacModes: [HVAC_MODE_HEAT, HVAC_MODE_COOL, HVAC_MODE_AUTO],
      presetMode: holdType === 7 ? PRESET_OFF
        : holdType === 2 ? PRESET_PERMANENT_HOLD
        : holdType === 10 ? PRESET_ECO
        : holdType === 1 ? PRESET_TEMPORARY_HOLD
        : PRESET_FOLLOW_SCHEDULE,
      presetModes: [PRESET_OFF, PRESET_PERMANENT_HOLD, PRESET_ECO, PRESET_TEMPORARY_HOLD, PRESET_FOLLOW_SCHEDULE],
      fanMode,
      fanModes: [FAN_MODE_AUTO, FAN_MODE_HIGH, FAN_MODE_MEDIUM, FAN_MODE_LOW, FAN_MODE_OFF],
      locked: device.sTherUIS?.LockKey === 1,
      supportedFeatures: SUPPORT_TARGET_TEMPERATURE | SUPPORT_PRESET_MODE | SUPPORT_FAN_MODE,
      ...extras,
    };
  } else {
    return null;
  }

  return climateDevice;
}
