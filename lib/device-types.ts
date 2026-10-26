/**
 * Device type interfaces for Salus IT600 devices.
 */

import type { HvacMode, HvacAction, PresetMode, FanMode } from './constants';

/** Raw device data from gateway API */
export interface DeviceData {
  UniID: string;
  Endpoint?: number;
  [key: string]: unknown;
}

/** Base device interface */
export interface BaseDevice {
  available: boolean;
  name: string;
  uniqueId: string;
  data: DeviceData;
  manufacturer: string;
  model: string | null;
  swVersion: string | null;
}

/** Gateway device */
export interface GatewayDevice {
  name: string;
  uniqueId: string;
  data: DeviceData;
  manufacturer: string;
  model: string | null;
  swVersion: string | null;
}

/** Climate/thermostat device */
export interface ClimateDevice extends BaseDevice {
  temperatureUnit: string;
  precision: number;
  currentTemperature: number;
  targetTemperature: number;
  maxTemp: number;
  minTemp: number;
  currentHumidity: number | null;
  batteryLevel: number | null;
  hvacMode: HvacMode;
  hvacAction: HvacAction;
  hvacModes: HvacMode[];
  presetMode: PresetMode;
  presetModes: PresetMode[];
  fanMode: FanMode | null;
  fanModes: FanMode[] | null;
  locked: boolean | null;
  supportedFeatures: number;
  /** Last reported signal strength; null until the gateway has reported one. */
  rssi: number | null;
  lqi: number | null;
  /** Descriptions of the active fault flags; empty when healthy. */
  problems: string[];
}

/** Wiring centre (it600WC): diagnostics only, it has no setpoint or relay state of its own. */
export interface WiringCentreDevice {
  available: boolean;
  name: string;
  uniqueId: string;
  data: DeviceData;
  model: string | null;
  connected: boolean;
  problems: string[];
  rssi: number | null;
  lqi: number | null;
}

/** Binary sensor device (door/window, moisture, smoke) */
export interface BinarySensorDevice extends BaseDevice {
  isOn: boolean;
  deviceClass: string | null;
}

/** Switch device (smart plug, relay) */
export interface SwitchDevice extends BaseDevice {
  isOn: boolean;
  deviceClass: string;
}

/** Cover device (blinds, roller shutter) */
export interface CoverDevice extends BaseDevice {
  currentPosition: number | null;
  isOpening: boolean | null;
  isClosing: boolean | null;
  isClosed: boolean;
  supportedFeatures: number;
  deviceClass: string | null;
}

/** Temperature sensor device */
export interface SensorDevice extends BaseDevice {
  state: number;
  unitOfMeasurement: string;
  deviceClass: string;
}

/** Device collections */
export interface DeviceCollections {
  gateway: GatewayDevice | null;
  climate: Map<string, ClimateDevice>;
  binarySensor: Map<string, BinarySensorDevice>;
  switch: Map<string, SwitchDevice>;
  cover: Map<string, CoverDevice>;
  sensor: Map<string, SensorDevice>;
}

/** API response status */
export interface ApiResponse {
  status: 'success' | 'error';
  id?: ApiDeviceStatus[];
}

/** Raw device status from API */
export interface ApiDeviceStatus {
  data: DeviceData;
  sGateway?: {
    NetworkLANMAC?: string;
    ModelIdentifier?: string;
  };
  sBasicS?: {
    ManufactureName?: string;
    ModelIdentifier?: string;
  };
  sOTA?: {
    OTAFirmwareVersion_d?: string;
  };
  sZDO?: {
    DeviceName?: string;
    FirmwareVersion?: string;
  };
  sZDOInfo?: {
    OnlineStatus_i?: number;
  };
  DeviceL?: {
    ModelIdentifier_i?: string;
  };
  sIT600TH?: {
    LocalTemperature_x100: number;
    HeatingSetpoint_x100: number;
    MaxHeatSetpoint_x100?: number;
    MinHeatSetpoint_x100?: number;
    HoldType: number;
    RunningState: number;
    SunnySetpoint_x100?: number;
    BatteryLevel?: number;
    /** ErrorNN fault flags (1 = active), see THERMOSTAT_ERROR_CODES. */
    [errorFlag: `Error${number}`]: number | undefined;
  };
  sTherS?: {
    LocalTemperature_x100: number;
    HeatingSetpoint_x100: number;
    CoolingSetpoint_x100: number;
    MaxHeatSetpoint_x100?: number;
    MinHeatSetpoint_x100?: number;
    MaxCoolSetpoint_x100?: number;
    MinCoolSetpoint_x100?: number;
    SystemMode: number;
    RunningState: number;
  };
  sComm?: {
    HoldType: number;
  };
  sFanS?: {
    FanMode: number;
  };
  sTherUIS?: {
    LockKey?: number;
  };
  sIASZS?: {
    ErrorIASZSAlarmed1?: number;
  };
  sIT600I?: {
    RelayStatus?: number;
    LastMessageRSSI_d?: number;
    LastMessageLQI_d?: number;
  };
  /** Wiring centre fault register: ErrorNN flags plus the ErrorCodeWC_d hex string. */
  sIT600WC?: Record<string, number | string | undefined>;
  sOnOffS?: {
    OnOff?: number;
  };
  sLevelS?: {
    CurrentLevel?: number;
    MoveToLevel_f?: string;
  };
  sTempS?: {
    MeasuredValue_x100?: number;
  };
  sButtonS?: {
    Mode?: number;
  };
}

/** Homey pairing device data */
export interface PairingDeviceData {
  name: string;
  data: {
    id: string;
  };
  store: {
    deviceData: DeviceData;
  };
  capabilities?: string[];
  capabilitiesOptions?: Record<string, unknown>;
}
