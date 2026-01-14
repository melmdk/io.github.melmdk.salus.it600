/**
 * Salus IT600 Gateway API client.
 * Handles encrypted communication with the UG600/UGE600 gateway.
 */

import * as crypto from 'crypto';
import * as http from 'http';

import {
  ENCRYPTION_IV,
  TEMP_CELSIUS,
  SUPPORT_TARGET_TEMPERATURE,
  SUPPORT_PRESET_MODE,
  SUPPORT_FAN_MODE,
  SUPPORT_OPEN,
  SUPPORT_CLOSE,
  SUPPORT_SET_POSITION,
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
  FAN_MODE_AUTO,
  FAN_MODE_HIGH,
  FAN_MODE_MEDIUM,
  FAN_MODE_LOW,
  FAN_MODE_OFF,
  DEVICE_CLASS_WINDOW,
  DEVICE_CLASS_MOISTURE,
  DEVICE_CLASS_SMOKE,
  DEVICE_CLASS_VALVE,
  DEVICE_CLASS_RECEIVER,
  DEVICE_CLASS_OUTLET,
  DEVICE_CLASS_SWITCH,
  DEFAULT_PORT,
  DEFAULT_REQUEST_TIMEOUT,
  BINARY_SENSOR_MODELS,
  BUTTON_MODELS,
  WINDOW_SENSOR_MODELS,
  MOISTURE_SENSOR_MODELS,
  SMOKE_SENSOR_MODELS,
  OUTLET_MODELS,
  HvacMode,
  PresetMode,
  FanMode,
} from './constants';

import type {
  DeviceData,
  GatewayDevice,
  ClimateDevice,
  BinarySensorDevice,
  SwitchDevice,
  CoverDevice,
  SensorDevice,
  ApiResponse,
  ApiDeviceStatus,
} from './device-types';

/** Custom error classes */
export class IT600Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IT600Error';
  }
}

export class IT600ConnectionError extends IT600Error {
  constructor(message: string) {
    super(message);
    this.name = 'IT600ConnectionError';
  }
}

export class IT600AuthenticationError extends IT600Error {
  constructor(message: string) {
    super(message);
    this.name = 'IT600AuthenticationError';
  }
}

export class IT600CommandError extends IT600Error {
  constructor(message: string) {
    super(message);
    this.name = 'IT600CommandError';
  }
}

/** Mutex for serializing requests */
class Mutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.locked = false;
    }
  }
}

/** IT600 Gateway API client */
export class IT600Gateway {
  private host: string;
  private port: number;
  private requestTimeout: number;
  private encryptionKey: Buffer;
  private mutex: Mutex;
  private debug: boolean;

  private gatewayDevice: GatewayDevice | null = null;
  private climateDevices: Map<string, ClimateDevice> = new Map();
  private binarySensorDevices: Map<string, BinarySensorDevice> = new Map();
  private switchDevices: Map<string, SwitchDevice> = new Map();
  private coverDevices: Map<string, CoverDevice> = new Map();
  private sensorDevices: Map<string, SensorDevice> = new Map();

  constructor(
    euid: string,
    host: string,
    port: number = DEFAULT_PORT,
    requestTimeout: number = DEFAULT_REQUEST_TIMEOUT,
    debug: boolean = false,
  ) {
    this.host = host;
    this.port = port;
    this.requestTimeout = requestTimeout;
    this.debug = debug;
    this.mutex = new Mutex();

    // Derive encryption key from EUID
    const hash = crypto.createHash('md5')
      .update(`Salus-${euid.toLowerCase()}`)
      .digest();
    this.encryptionKey = Buffer.concat([hash, Buffer.alloc(16)]);
  }

  /** Encrypt data using AES-128-CBC */
  private encrypt(plain: string): Buffer {
    const cipher = crypto.createCipheriv('aes-128-cbc', this.encryptionKey.subarray(0, 16), ENCRYPTION_IV);
    const padded = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return padded;
  }

  /** Decrypt data using AES-128-CBC */
  private decrypt(encrypted: Buffer): string {
    const decipher = crypto.createDecipheriv('aes-128-cbc', this.encryptionKey.subarray(0, 16), ENCRYPTION_IV);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /** Make encrypted HTTP request to gateway */
  private async makeRequest(command: string, body: Record<string, unknown>): Promise<ApiResponse> {
    await this.mutex.acquire();

    try {
      const url = `/deviceid/${command}`;
      const bodyJson = JSON.stringify(body);
      const encryptedBody = this.encrypt(bodyJson);

      if (this.debug) {
        console.log(`Gateway request: POST ${url}`);
        console.log(bodyJson);
      }

      const response = await new Promise<Buffer>((resolve, reject) => {
        const req = http.request(
          {
            hostname: this.host,
            port: this.port,
            path: url,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': encryptedBody.length,
            },
            timeout: this.requestTimeout,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
          },
        );

        req.on('error', (err) => {
          reject(new IT600ConnectionError(
            `Error communicating with gateway: ${err.message}`,
          ));
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new IT600ConnectionError('Gateway request timeout'));
        });

        req.write(encryptedBody);
        req.end();
      });

      const decrypted = this.decrypt(response);

      if (this.debug) {
        console.log('Gateway response:');
        console.log(decrypted);
      }

      const responseJson = JSON.parse(decrypted) as ApiResponse;

      if (responseJson.status !== 'success') {
        throw new IT600CommandError(
          `Gateway rejected '${command}' command`,
        );
      }

      return responseJson;
    } finally {
      this.mutex.release();
    }
  }

  /** Connect to gateway and validate credentials */
  async connect(): Promise<string> {
    try {
      const response = await this.makeRequest('read', { requestAttr: 'readall' });

      const gateway = response.id?.find(
        (device) => device.sGateway?.NetworkLANMAC && device.sGateway.NetworkLANMAC.length > 0,
      );

      if (!gateway?.sGateway?.NetworkLANMAC) {
        throw new IT600CommandError('Gateway response did not contain gateway information');
      }

      return gateway.sGateway.NetworkLANMAC;
    } catch (err) {
      if (err instanceof IT600ConnectionError) {
        // Try a simple HTTP request to check if host is reachable
        try {
          await new Promise<void>((resolve, reject) => {
            const req = http.get(
              { hostname: this.host, port: this.port, timeout: this.requestTimeout },
              () => resolve(),
            );
            req.on('error', reject);
            req.on('timeout', () => {
              req.destroy();
              reject(new Error('timeout'));
            });
          });

          // Host is reachable but decryption failed - wrong EUID
          throw new IT600AuthenticationError('Check if EUID is correct');
        } catch {
          throw new IT600ConnectionError('Check if host/IP address is correct');
        }
      }
      throw err;
    }
  }

  /** Poll status of all devices */
  async pollStatus(): Promise<void> {
    const response = await this.makeRequest('read', { requestAttr: 'readall' });

    if (!response.id) return;

    // Parse gateway
    const gatewayDevices = response.id.filter((d) => d.sGateway);
    this.refreshGatewayDevice(gatewayDevices);

    // Parse climate devices
    const climateDevices = response.id.filter((d) => d.sIT600TH || d.sTherS);
    await this.refreshClimateDevices(climateDevices);

    // Parse binary sensors
    const binarySensors = response.id.filter((d) =>
      d.sIASZS ||
      (d.sBasicS?.ModelIdentifier && BINARY_SENSOR_MODELS.includes(d.sBasicS.ModelIdentifier)),
    );
    await this.refreshBinarySensorDevices(binarySensors);

    // Parse temperature sensors
    const tempSensors = response.id.filter((d) => d.sTempS);
    await this.refreshSensorDevices(tempSensors);

    // Parse switches
    const switches = response.id.filter((d) => d.sOnOffS);
    await this.refreshSwitchDevices(switches);

    // Parse covers
    const covers = response.id.filter((d) => d.sLevelS);
    await this.refreshCoverDevices(covers);
  }

  /** Parse device name from JSON string */
  private parseDeviceName(deviceNameJson: string | undefined, fallback: string): string {
    if (!deviceNameJson) return fallback;
    try {
      const parsed = JSON.parse(deviceNameJson) as { deviceName?: string };
      return parsed.deviceName || fallback;
    } catch {
      return fallback;
    }
  }

  /** Refresh gateway device */
  private refreshGatewayDevice(devices: ApiDeviceStatus[]): void {
    for (const device of devices) {
      const uniqueId = device.sGateway?.NetworkLANMAC;
      if (!uniqueId) continue;

      this.gatewayDevice = {
        name: device.sGateway?.ModelIdentifier || 'Gateway',
        uniqueId,
        data: device.data,
        manufacturer: device.sBasicS?.ManufactureName || 'SALUS',
        model: device.sGateway?.ModelIdentifier || null,
        swVersion: device.sOTA?.OTAFirmwareVersion_d || null,
      };
    }
  }

  /** Refresh climate devices */
  private async refreshClimateDevices(devices: ApiDeviceStatus[]): Promise<void> {
    if (devices.length === 0) return;

    const status = await this.makeRequest('read', {
      requestAttr: 'deviceid',
      id: devices.map((d) => ({ data: d.data })),
    });

    const newDevices = new Map<string, ClimateDevice>();

    for (const device of status.id || []) {
      const uniqueId = device.data?.UniID;
      if (!uniqueId) continue;

      try {
        const model = device.DeviceL?.ModelIdentifier_i || null;
        const th = device.sIT600TH;
        const ther = device.sTherS;
        const scomm = device.sComm;
        const sfans = device.sFanS;

        const baseProps = {
          available: device.sZDOInfo?.OnlineStatus_i === 1,
          name: this.parseDeviceName(device.sZDO?.DeviceName, 'Unknown'),
          uniqueId,
          temperatureUnit: TEMP_CELSIUS,
          precision: 0.1,
          data: device.data,
          manufacturer: device.sBasicS?.ManufactureName || 'SALUS',
          model,
          swVersion: device.sZDO?.FirmwareVersion || null,
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
            currentTemperature: th.LocalTemperature_x100 / 100,
            targetTemperature: th.HeatingSetpoint_x100 / 100,
            maxTemp: (th.MaxHeatSetpoint_x100 ?? 3500) / 100,
            minTemp: (th.MinHeatSetpoint_x100 ?? 500) / 100,
            hvacMode: holdType === 7 ? HVAC_MODE_OFF : holdType === 2 ? HVAC_MODE_HEAT : HVAC_MODE_AUTO,
            hvacAction: holdType === 7 ? CURRENT_HVAC_OFF : runningState % 2 === 0 ? CURRENT_HVAC_IDLE : CURRENT_HVAC_HEAT,
            hvacModes: [HVAC_MODE_OFF, HVAC_MODE_HEAT, HVAC_MODE_AUTO],
            presetMode: holdType === 7 ? PRESET_OFF : holdType === 2 ? PRESET_PERMANENT_HOLD : PRESET_FOLLOW_SCHEDULE,
            presetModes: [PRESET_FOLLOW_SCHEDULE, PRESET_PERMANENT_HOLD, PRESET_OFF],
            fanMode: null,
            fanModes: null,
            locked: null,
            supportedFeatures: SUPPORT_TARGET_TEMPERATURE | SUPPORT_PRESET_MODE,
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
          };
        } else {
          continue;
        }

        newDevices.set(uniqueId, climateDevice);
      } catch (err) {
        console.error(`Failed to parse climate device ${uniqueId}:`, err);
      }
    }

    this.climateDevices = newDevices;
  }

  /** Refresh binary sensor devices */
  private async refreshBinarySensorDevices(devices: ApiDeviceStatus[]): Promise<void> {
    if (devices.length === 0) return;

    const status = await this.makeRequest('read', {
      requestAttr: 'deviceid',
      id: devices.map((d) => ({ data: d.data })),
    });

    const newDevices = new Map<string, BinarySensorDevice>();

    for (const device of status.id || []) {
      const uniqueId = device.data?.UniID;
      if (!uniqueId) continue;

      try {
        const model = device.DeviceL?.ModelIdentifier_i || null;

        // Skip buttons
        if (model && BUTTON_MODELS.includes(model)) continue;

        let isOn: boolean | null = null;
        if (model && BINARY_SENSOR_MODELS.includes(model)) {
          isOn = device.sIT600I?.RelayStatus === 1;
        } else {
          isOn = device.sIASZS?.ErrorIASZSAlarmed1 === 1;
        }

        if (isOn === null) continue;

        let deviceClass: string | null = null;
        if (model && WINDOW_SENSOR_MODELS.includes(model)) {
          deviceClass = DEVICE_CLASS_WINDOW;
        } else if (model && MOISTURE_SENSOR_MODELS.includes(model)) {
          deviceClass = DEVICE_CLASS_MOISTURE;
        } else if (model && SMOKE_SENSOR_MODELS.includes(model)) {
          deviceClass = DEVICE_CLASS_SMOKE;
        } else if (model === 'it600MINITRV') {
          deviceClass = DEVICE_CLASS_VALVE;
        } else if (model === 'it600Receiver') {
          deviceClass = DEVICE_CLASS_RECEIVER;
        }

        const binarySensor: BinarySensorDevice = {
          available: device.sZDOInfo?.OnlineStatus_i === 1,
          name: this.parseDeviceName(device.sZDO?.DeviceName, 'Unknown'),
          uniqueId,
          isOn,
          deviceClass,
          data: device.data,
          manufacturer: device.sBasicS?.ManufactureName || 'SALUS',
          model,
          swVersion: device.sZDO?.FirmwareVersion || null,
        };

        newDevices.set(uniqueId, binarySensor);
      } catch (err) {
        console.error(`Failed to parse binary sensor ${uniqueId}:`, err);
      }
    }

    this.binarySensorDevices = newDevices;
  }

  /** Refresh temperature sensor devices */
  private async refreshSensorDevices(devices: ApiDeviceStatus[]): Promise<void> {
    if (devices.length === 0) return;

    const status = await this.makeRequest('read', {
      requestAttr: 'deviceid',
      id: devices.map((d) => ({ data: d.data })),
    });

    const newDevices = new Map<string, SensorDevice>();

    for (const device of status.id || []) {
      const uniqueId = device.data?.UniID;
      if (!uniqueId) continue;

      try {
        const temperature = device.sTempS?.MeasuredValue_x100;
        if (temperature === undefined) continue;

        const sensorId = `${uniqueId}_temp`;
        const model = device.DeviceL?.ModelIdentifier_i || null;

        const sensor: SensorDevice = {
          available: device.sZDOInfo?.OnlineStatus_i === 1,
          name: this.parseDeviceName(device.sZDO?.DeviceName, 'Unknown'),
          uniqueId: sensorId,
          state: temperature / 100,
          unitOfMeasurement: TEMP_CELSIUS,
          deviceClass: 'temperature',
          data: device.data,
          manufacturer: device.sBasicS?.ManufactureName || 'SALUS',
          model,
          swVersion: device.sZDO?.FirmwareVersion || null,
        };

        newDevices.set(sensorId, sensor);
      } catch (err) {
        console.error(`Failed to parse sensor ${uniqueId}:`, err);
      }
    }

    this.sensorDevices = newDevices;
  }

  /** Refresh switch devices */
  private async refreshSwitchDevices(devices: ApiDeviceStatus[]): Promise<void> {
    if (devices.length === 0) return;

    const status = await this.makeRequest('read', {
      requestAttr: 'deviceid',
      id: devices.map((d) => ({ data: d.data })),
    });

    const newDevices = new Map<string, SwitchDevice>();

    for (const device of status.id || []) {
      const baseUniqueId = device.data?.UniID;
      if (!baseUniqueId) continue;

      try {
        // Skip if this is a cover device
        if (device.sLevelS !== undefined) continue;

        const isOn = device.sOnOffS?.OnOff;
        if (isOn === undefined) continue;

        const uniqueId = `${baseUniqueId}_${device.data.Endpoint || 0}`;
        const model = device.DeviceL?.ModelIdentifier_i || null;

        const switchDevice: SwitchDevice = {
          available: device.sZDOInfo?.OnlineStatus_i === 1,
          name: this.parseDeviceName(device.sZDO?.DeviceName, uniqueId),
          uniqueId,
          isOn: isOn === 1,
          deviceClass: model && OUTLET_MODELS.includes(model) ? DEVICE_CLASS_OUTLET : DEVICE_CLASS_SWITCH,
          data: device.data,
          manufacturer: device.sBasicS?.ManufactureName || 'SALUS',
          model,
          swVersion: device.sZDO?.FirmwareVersion || null,
        };

        newDevices.set(uniqueId, switchDevice);
      } catch (err) {
        console.error(`Failed to parse switch ${baseUniqueId}:`, err);
      }
    }

    this.switchDevices = newDevices;
  }

  /** Refresh cover devices */
  private async refreshCoverDevices(devices: ApiDeviceStatus[]): Promise<void> {
    if (devices.length === 0) return;

    const status = await this.makeRequest('read', {
      requestAttr: 'deviceid',
      id: devices.map((d) => ({ data: d.data })),
    });

    const newDevices = new Map<string, CoverDevice>();

    for (const device of status.id || []) {
      const uniqueId = device.data?.UniID;
      if (!uniqueId) continue;

      try {
        // Skip disabled endpoints
        if (device.sButtonS?.Mode === 0) continue;

        const currentPosition = device.sLevelS?.CurrentLevel ?? null;
        const moveToLevelF = device.sLevelS?.MoveToLevel_f;

        let setPosition: number | null = null;
        if (moveToLevelF && moveToLevelF.length >= 2) {
          setPosition = parseInt(moveToLevelF.substring(0, 2), 16);
        }

        const model = device.DeviceL?.ModelIdentifier_i || null;

        const coverDevice: CoverDevice = {
          available: device.sZDOInfo?.OnlineStatus_i === 1,
          name: this.parseDeviceName(device.sZDO?.DeviceName, 'Unknown'),
          uniqueId,
          currentPosition,
          isOpening: setPosition !== null && currentPosition !== null ? currentPosition < setPosition : null,
          isClosing: setPosition !== null && currentPosition !== null ? currentPosition > setPosition : null,
          isClosed: currentPosition === 0,
          supportedFeatures: SUPPORT_OPEN | SUPPORT_CLOSE | SUPPORT_SET_POSITION,
          deviceClass: null,
          data: device.data,
          manufacturer: device.sBasicS?.ManufactureName || 'SALUS',
          model,
          swVersion: device.sZDO?.FirmwareVersion || null,
        };

        newDevices.set(uniqueId, coverDevice);
      } catch (err) {
        console.error(`Failed to parse cover ${uniqueId}:`, err);
      }
    }

    this.coverDevices = newDevices;
  }

  /** Round temperature to nearest 0.5 */
  private roundToHalf(value: number): number {
    return Math.round(value * 2) / 2;
  }

  // Getters for device collections
  getGatewayDevice(): GatewayDevice | null {
    return this.gatewayDevice;
  }

  getClimateDevices(): Map<string, ClimateDevice> {
    return this.climateDevices;
  }

  getClimateDevice(deviceId: string): ClimateDevice | undefined {
    return this.climateDevices.get(deviceId);
  }

  getBinarySensorDevices(): Map<string, BinarySensorDevice> {
    return this.binarySensorDevices;
  }

  getBinarySensorDevice(deviceId: string): BinarySensorDevice | undefined {
    return this.binarySensorDevices.get(deviceId);
  }

  getSwitchDevices(): Map<string, SwitchDevice> {
    return this.switchDevices;
  }

  getSwitchDevice(deviceId: string): SwitchDevice | undefined {
    return this.switchDevices.get(deviceId);
  }

  getCoverDevices(): Map<string, CoverDevice> {
    return this.coverDevices;
  }

  getCoverDevice(deviceId: string): CoverDevice | undefined {
    return this.coverDevices.get(deviceId);
  }

  getSensorDevices(): Map<string, SensorDevice> {
    return this.sensorDevices;
  }

  getSensorDevice(deviceId: string): SensorDevice | undefined {
    return this.sensorDevices.get(deviceId);
  }

  // Command methods

  /** Set target temperature for climate device */
  async setClimateTemperature(deviceId: string, temperature: number): Promise<void> {
    const device = this.getClimateDevice(deviceId);
    if (!device) {
      throw new IT600CommandError(`Climate device not found: ${deviceId}`);
    }

    const tempValue = Math.round(this.roundToHalf(temperature) * 100);

    let requestData: Record<string, unknown>;
    if (device.model === 'FC600') {
      if (device.hvacMode === HVAC_MODE_COOL) {
        requestData = { sTherS: { SetCoolingSetpoint_x100: tempValue } };
      } else {
        requestData = { sTherS: { SetHeatingSetpoint_x100: tempValue } };
      }
    } else {
      requestData = { sIT600TH: { SetHeatingSetpoint_x100: tempValue } };
    }

    await this.makeRequest('write', {
      requestAttr: 'write',
      id: [{ data: device.data, ...requestData }],
    });
  }

  /** Set HVAC mode for climate device */
  async setClimateMode(deviceId: string, mode: HvacMode): Promise<void> {
    const device = this.getClimateDevice(deviceId);
    if (!device) {
      throw new IT600CommandError(`Climate device not found: ${deviceId}`);
    }

    let requestData: Record<string, unknown>;
    if (device.model === 'FC600') {
      const systemMode = mode === HVAC_MODE_HEAT ? 4 : mode === HVAC_MODE_COOL ? 3 : 0;
      requestData = { sTherS: { SetSystemMode: systemMode } };
    } else {
      const holdType = mode === HVAC_MODE_OFF ? 7 : 0;
      requestData = { sIT600TH: { SetHoldType: holdType } };
    }

    await this.makeRequest('write', {
      requestAttr: 'write',
      id: [{ data: device.data, ...requestData }],
    });
  }

  /** Set preset mode for climate device */
  async setClimatePreset(deviceId: string, preset: PresetMode): Promise<void> {
    const device = this.getClimateDevice(deviceId);
    if (!device) {
      throw new IT600CommandError(`Climate device not found: ${deviceId}`);
    }

    let holdType: number;
    if (preset === PRESET_OFF) holdType = 7;
    else if (preset === PRESET_ECO) holdType = 10;
    else if (preset === PRESET_PERMANENT_HOLD) holdType = 2;
    else if (preset === PRESET_TEMPORARY_HOLD) holdType = 1;
    else holdType = 0; // Follow Schedule

    let requestData: Record<string, unknown>;
    if (device.model === 'FC600') {
      requestData = { sComm: { SetHoldType: holdType } };
    } else {
      // Standard thermostats don't support Eco or Temporary Hold
      if (holdType === 10 || holdType === 1) holdType = 0;
      requestData = { sIT600TH: { SetHoldType: holdType } };
    }

    await this.makeRequest('write', {
      requestAttr: 'write',
      id: [{ data: device.data, ...requestData }],
    });
  }

  /** Set fan mode for FC600 climate device */
  async setClimateFanMode(deviceId: string, mode: FanMode): Promise<void> {
    const device = this.getClimateDevice(deviceId);
    if (!device) {
      throw new IT600CommandError(`Climate device not found: ${deviceId}`);
    }

    let fanModeValue: number;
    if (mode === FAN_MODE_OFF) fanModeValue = 0;
    else if (mode === FAN_MODE_LOW) fanModeValue = 1;
    else if (mode === FAN_MODE_MEDIUM) fanModeValue = 2;
    else if (mode === FAN_MODE_HIGH) fanModeValue = 3;
    else fanModeValue = 5; // Auto

    await this.makeRequest('write', {
      requestAttr: 'write',
      id: [{ data: device.data, sFanS: { FanMode: fanModeValue } }],
    });
  }

  /** Turn on switch device */
  async turnOnSwitch(deviceId: string): Promise<void> {
    const device = this.getSwitchDevice(deviceId);
    if (!device) {
      throw new IT600CommandError(`Switch device not found: ${deviceId}`);
    }

    await this.makeRequest('write', {
      requestAttr: 'write',
      id: [{ data: device.data, sOnOffS: { SetOnOff: 1 } }],
    });
  }

  /** Turn off switch device */
  async turnOffSwitch(deviceId: string): Promise<void> {
    const device = this.getSwitchDevice(deviceId);
    if (!device) {
      throw new IT600CommandError(`Switch device not found: ${deviceId}`);
    }

    await this.makeRequest('write', {
      requestAttr: 'write',
      id: [{ data: device.data, sOnOffS: { SetOnOff: 0 } }],
    });
  }

  /** Set cover position (0 = closed, 100 = open) */
  async setCoverPosition(deviceId: string, position: number): Promise<void> {
    if (position < 0 || position > 100) {
      throw new Error('Position must be between 0 and 100');
    }

    const device = this.getCoverDevice(deviceId);
    if (!device) {
      throw new IT600CommandError(`Cover device not found: ${deviceId}`);
    }

    const positionHex = position.toString(16).padStart(2, '0').toUpperCase();

    await this.makeRequest('write', {
      requestAttr: 'write',
      id: [{ data: device.data, sLevelS: { SetMoveToLevel: `${positionHex}FFFF` } }],
    });
  }

  /** Open cover */
  async openCover(deviceId: string): Promise<void> {
    await this.setCoverPosition(deviceId, 100);
  }

  /** Close cover */
  async closeCover(deviceId: string): Promise<void> {
    await this.setCoverPosition(deviceId, 0);
  }
}
