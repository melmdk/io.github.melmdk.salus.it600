/**
 * Constants for the Salus IT600 smart devices.
 */

// AES encryption IV (fixed for Salus gateway)
export const ENCRYPTION_IV = Buffer.from([
  0x88, 0xa6, 0xb0, 0x79, 0x5d, 0x85, 0xdb, 0xfc,
  0xe6, 0xe0, 0xb3, 0xe9, 0xa6, 0x29, 0x65, 0x4b,
]);

// Temperature units
export const TEMP_CELSIUS = '°C';

// Supported climate features (bitmask)
export const SUPPORT_TARGET_TEMPERATURE = 1;
export const SUPPORT_FAN_MODE = 8;
export const SUPPORT_PRESET_MODE = 16;

// Supported cover features (bitmask)
export const SUPPORT_OPEN = 1;
export const SUPPORT_CLOSE = 2;
export const SUPPORT_SET_POSITION = 4;

// HVAC modes
export const HVAC_MODE_OFF = 'off';
export const HVAC_MODE_HEAT = 'heat';
export const HVAC_MODE_COOL = 'cool';
export const HVAC_MODE_AUTO = 'auto';

export type HvacMode = typeof HVAC_MODE_OFF | typeof HVAC_MODE_HEAT | typeof HVAC_MODE_COOL | typeof HVAC_MODE_AUTO;

// HVAC states/actions
export const CURRENT_HVAC_OFF = 'off';
export const CURRENT_HVAC_HEAT = 'heating';
export const CURRENT_HVAC_HEAT_IDLE = 'heating (idling)';
export const CURRENT_HVAC_COOL = 'cooling';
export const CURRENT_HVAC_COOL_IDLE = 'cooling (idling)';
export const CURRENT_HVAC_IDLE = 'idle';

export type HvacAction =
  | typeof CURRENT_HVAC_OFF
  | typeof CURRENT_HVAC_HEAT
  | typeof CURRENT_HVAC_HEAT_IDLE
  | typeof CURRENT_HVAC_COOL
  | typeof CURRENT_HVAC_COOL_IDLE
  | typeof CURRENT_HVAC_IDLE;

// Preset modes
export const PRESET_FOLLOW_SCHEDULE = 'Follow Schedule';
export const PRESET_PERMANENT_HOLD = 'Permanent Hold';
export const PRESET_TEMPORARY_HOLD = 'Temporary Hold';
export const PRESET_ECO = 'Eco';
export const PRESET_OFF = 'Off';

export type PresetMode =
  | typeof PRESET_FOLLOW_SCHEDULE
  | typeof PRESET_PERMANENT_HOLD
  | typeof PRESET_TEMPORARY_HOLD
  | typeof PRESET_ECO
  | typeof PRESET_OFF;

// Fan modes
export const FAN_MODE_AUTO = 'Auto';
export const FAN_MODE_HIGH = 'High';
export const FAN_MODE_MEDIUM = 'Medium';
export const FAN_MODE_LOW = 'Low';
export const FAN_MODE_OFF = 'Off';

export type FanMode =
  | typeof FAN_MODE_AUTO
  | typeof FAN_MODE_HIGH
  | typeof FAN_MODE_MEDIUM
  | typeof FAN_MODE_LOW
  | typeof FAN_MODE_OFF;

// Binary sensor device classes
export const DEVICE_CLASS_WINDOW = 'window';
export const DEVICE_CLASS_MOISTURE = 'moisture';
export const DEVICE_CLASS_SMOKE = 'smoke';
export const DEVICE_CLASS_VALVE = 'valve';
export const DEVICE_CLASS_RECEIVER = 'receiver';

// Switch device classes
export const DEVICE_CLASS_OUTLET = 'outlet';
export const DEVICE_CLASS_SWITCH = 'switch';

// Default values
export const DEFAULT_PORT = 80;
export const DEFAULT_REQUEST_TIMEOUT = 5000; // ms
export const DEFAULT_POLL_INTERVAL = 30000; // 30 seconds

// Model identifiers for device type detection
export const BINARY_SENSOR_MODELS = ['it600MINITRV', 'it600Receiver'];
export const BUTTON_MODELS = ['SB600', 'CSB600'];
export const WINDOW_SENSOR_MODELS = ['SW600', 'OS600'];
export const MOISTURE_SENSOR_MODELS = ['WLS600'];
export const SMOKE_SENSOR_MODELS = ['SmokeSensor-EM'];
export const OUTLET_MODELS = ['SP600', 'SPE600'];
