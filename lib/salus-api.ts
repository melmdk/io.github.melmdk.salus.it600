/**
 * Salus IT600 Gateway API client.
 * Handles encrypted communication with the UG600/UGE600 gateway.
 */

import { AesCbcProtocol, createProtocol, normaliseEuid, protocolCandidates } from './protocol';
import type { GatewayProtocol, ProtocolName } from './protocol';
import { httpTransport, TransportError } from './transport';
import type { Transport } from './transport';
import { modelOf, parseDeviceName } from './parsers/common';
import { parseClimateDevice } from './parsers/climate';
import { parseWiringCentre } from './parsers/wiring-centre';

import {
  TEMP_CELSIUS,
  SUPPORT_OPEN,
  SUPPORT_CLOSE,
  SUPPORT_SET_POSITION,
  HVAC_MODE_OFF,
  HVAC_MODE_HEAT,
  HVAC_MODE_COOL,
  PRESET_PERMANENT_HOLD,
  PRESET_TEMPORARY_HOLD,
  PRESET_ECO,
  PRESET_OFF,
  PRESET_AWAY,
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
  GatewayDevice,
  ClimateDevice,
  WiringCentreDevice,
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

/** Every candidate was refused or undecryptable, but the gateway answers. */
export class IT600UnsupportedFirmwareError extends IT600Error {
  constructor(message: string) {
    super(message);
    this.name = 'IT600UnsupportedFirmwareError';
  }
}

export class IT600CommandError extends IT600Error {
  constructor(message: string) {
    super(message);
    this.name = 'IT600CommandError';
  }
}

/** Gateway decrypted the request but answered `status != success`. */
class IT600RejectedError extends IT600CommandError {}

/** Consecutive dropped combined requests before they are switched off. */
const COMBINED_FAILURE_LIMIT = 3;

/** One kind of device, fetched and refreshed together. */
interface DeviceFamily {
  name: string;
  devices: ApiDeviceStatus[];
  refresh: (details: ApiDeviceStatus[]) => void;
}

const detailKey = (device: ApiDeviceStatus): string => `${device.data?.UniID}|${device.data?.Endpoint}`;

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
  private euid: string;
  private host: string;
  private transport: Transport;
  private protocol: GatewayProtocol;
  /** True once `protocol` is known to work (stored or detected). */
  private detected = false;
  private mutex: Mutex;
  private debug: boolean;

  private gatewayDevice: GatewayDevice | null = null;
  private climateDevices: Map<string, ClimateDevice> = new Map();
  private wiringCentreDevices: Map<string, WiringCentreDevice> = new Map();
  private binarySensorDevices: Map<string, BinarySensorDevice> = new Map();
  private switchDevices: Map<string, SwitchDevice> = new Map();
  private coverDevices: Map<string, CoverDevice> = new Map();
  private sensorDevices: Map<string, SensorDevice> = new Map();
  private pendingReadall: ApiResponse | null = null;
  private combinedDetails = false;
  private combinedFailures = 0;
  private usedCombined = false;

  constructor(
    euid: string,
    host: string,
    opts: {
      port?: number;
      requestTimeout?: number;
      debug?: boolean;
      protocol?: ProtocolName;
      transport?: Transport;
    } = {},
  ) {
    this.euid = normaliseEuid(euid);
    this.host = host;
    this.debug = opts.debug ?? false;
    this.mutex = new Mutex();
    this.transport = opts.transport
      ?? httpTransport(host, opts.port ?? DEFAULT_PORT, opts.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT);

    // Until detection runs, talk the legacy protocol; a stored name that is
    // unknown or unusable for this EUID counts as "none stored".
    this.protocol = new AesCbcProtocol(this.euid);
    if (opts.protocol) {
      try {
        this.protocol = createProtocol(opts.protocol, this.euid);
        this.detected = true;
      } catch {
        // fall through to probing
      }
    }
  }

  /** Send one request under `protocol` and return the parsed, successful response. */
  private async exchange(
    protocol: GatewayProtocol,
    command: string,
    body: Record<string, unknown>,
  ): Promise<ApiResponse> {
    await this.mutex.acquire();

    try {
      const url = `/deviceid/${command}`;
      const bodyJson = JSON.stringify(body);

      if (this.debug) {
        console.log(`Gateway request (${protocol.name}): POST ${url}`);
        console.log(bodyJson);
      }

      let raw: Buffer;
      try {
        raw = await this.transport(url, protocol.wrapRequest(bodyJson));
      } catch (err) {
        if (err instanceof TransportError) throw new IT600ConnectionError(err.message);
        throw err;
      }

      // Throws when the frame cannot be decrypted or is not valid JSON.
      const decrypted = protocol.unwrapResponse(raw);
      const responseJson = JSON.parse(decrypted) as ApiResponse;

      if (this.debug) {
        console.log('Gateway response:');
        console.log(decrypted);
      }

      if (responseJson.status !== 'success') {
        throw new IT600RejectedError(`Gateway rejected '${command}' command`);
      }

      return responseJson;
    } finally {
      this.mutex.release();
    }
  }

  /** Make encrypted request to gateway using the current protocol */
  private makeRequest(command: string, body: Record<string, unknown>): Promise<ApiResponse> {
    return this.exchange(this.protocol, command, body);
  }

  /** Protocol detected or stored for this gateway, or null if not known yet. */
  get protocolName(): ProtocolName | null {
    return this.detected ? this.protocol.name : null;
  }

  /**
   * Connect to the gateway, detecting its protocol: the stored one first, then
   * cbc-256, cbc-128 and ccm. Mirrors salus-it600-client's detection.
   */
  async connect(): Promise<{ gatewayMac: string; protocol: ProtocolName }> {
    const candidates: GatewayProtocol[] = [];
    if (this.detected) candidates.push(this.protocol);
    for (const candidate of protocolCandidates(this.euid)) {
      if (!candidates.some((c) => c.name === candidate.name)) candidates.push(candidate);
    }

    const unreachable = () => new IT600ConnectionError(`No gateway answering at ${this.host}`);
    const rootAnswers = async (): Promise<boolean> => {
      try {
        await this.transport.probeRoot?.();
        return true;
      } catch {
        return false;
      }
    };

    let sawReject = false;
    let sawGarbage = false;
    let sawTransportError = false;
    let response: ApiResponse | null = null;
    for (const candidate of candidates) {
      try {
        response = await this.exchange(candidate, 'read', { requestAttr: 'readall' });
        this.protocol = candidate;
        this.detected = true;
        break;
      } catch (err) {
        if (this.debug) console.log(`Protocol ${candidate.name} failed: ${(err as Error).message}`);
        if (err instanceof IT600ConnectionError) {
          sawTransportError = true;
          // Network failure: stop at once if nothing answers, so a dead host
          // costs one timeout instead of one per candidate.
          if (!(await rootAnswers())) throw unreachable();
        } else if (err instanceof IT600RejectedError) {
          sawReject = true;
        } else {
          sawGarbage = true;
        }
      }
    }

    if (response) {
      const mac = response.id?.find(
        (device) => device.sGateway?.NetworkLANMAC && device.sGateway.NetworkLANMAC.length > 0,
      )?.sGateway?.NetworkLANMAC;
      if (!mac) {
        throw new IT600CommandError('Gateway response did not contain gateway information');
      }
      // Cache readall response so first pollStatus() can reuse it
      this.pendingReadall = response;
      return { gatewayMac: mac, protocol: this.protocol.name };
    }

    if (!(await rootAnswers())) throw unreachable();
    if (sawReject) {
      throw new IT600UnsupportedFirmwareError("Gateway firmware uses an encryption this app doesn't support");
    }
    // A skipped candidate may have been the right one, so garbage alone proves nothing.
    if (sawGarbage && !sawTransportError) {
      throw new IT600AuthenticationError('Wrong EUID: check the 16 characters on the gateway label');
    }
    // Only network failures, although the root answers: not an EUID problem.
    throw unreachable();
  }

  /** Fetch deviceid details for a filtered set of devices */
  private async fetchDeviceDetails(devices: ApiDeviceStatus[]): Promise<ApiDeviceStatus[]> {
    if (devices.length === 0) return [];
    const status = await this.makeRequest('read', {
      requestAttr: 'deviceid',
      id: devices.map((d) => ({ data: d.data })),
    });
    return status.id || [];
  }

  /** Whether polls fetch all device details in one `deviceid` request. Off by default. */
  get combinedDetailRequests(): boolean {
    return this.combinedDetails;
  }

  /** True when the last poll's details came from a fully validated combined answer. */
  get lastPollUsedCombined(): boolean {
    return this.usedCombined;
  }

  /** Opt in or out of combined `deviceid` requests (a failure switches them off again). */
  setCombinedDetailRequests(enabled: boolean): void {
    this.combinedDetails = enabled;
    this.combinedFailures = 0;
  }

  private disableCombinedDetailRequests(reason: string): void {
    this.combinedDetails = false;
    console.log(`Requesting device details per device type from now on, the combined request did not work (${reason})`);
  }

  /**
   * Fetch every family's details in one `deviceid` request. Returns null (so
   * callers go per type) when the gateway rejects it, leaves a device out, or
   * drops the connection COMBINED_FAILURE_LIMIT times in a row.
   */
  private async fetchCombinedDetails(families: DeviceFamily[]): Promise<Map<string, ApiDeviceStatus> | null> {
    const requested = new Map<string, ApiDeviceStatus>();
    for (const family of families) {
      for (const device of family.devices) {
        if (device.data?.UniID) requested.set(detailKey(device), device);
      }
    }
    if (requested.size === 0) return null;

    let answer: ApiDeviceStatus[];
    try {
      const status = await this.makeRequest('read', {
        requestAttr: 'deviceid',
        id: [...requested.values()].map((d) => ({ data: d.data })),
      });
      answer = status.id || [];
    } catch (err) {
      if (err instanceof IT600CommandError) {
        this.disableCombinedDetailRequests(`gateway rejected it: ${err.message}`);
      } else if (err instanceof IT600ConnectionError) {
        this.combinedFailures += 1;
        if (this.debug) console.log(`Combined details request failed (${this.combinedFailures}/${COMBINED_FAILURE_LIMIT}): ${err.message}`);
        if (this.combinedFailures >= COMBINED_FAILURE_LIMIT) {
          this.disableCombinedDetailRequests('repeated connection failures');
        }
      } else if (this.debug) {
        console.log(`Combined details request failed: ${(err as Error).message}`);
      }
      return null;
    }

    const indexed = new Map<string, ApiDeviceStatus>();
    for (const item of answer) {
      if (item.data?.UniID) indexed.set(detailKey(item), item);
    }
    // Same key as the lookup in pollStatus, so nothing validated is later dropped.
    const missing = [...requested.keys()].filter((key) => !indexed.has(key));
    if (missing.length > 0) {
      this.disableCombinedDetailRequests(`answer left out ${missing.length} of ${requested.size} devices`);
      return null;
    }

    this.combinedFailures = 0;
    return indexed;
  }

  /** Poll status of all devices */
  async pollStatus(): Promise<void> {
    // Reuse cached readall from connect() if available
    const fromCache = this.pendingReadall !== null;
    const response = this.pendingReadall ?? await this.makeRequest('read', { requestAttr: 'readall' });
    this.pendingReadall = null;

    if (!response.id) return;

    // Parse gateway (uses readall data directly)
    const gatewayDevices = response.id.filter((d) => d.sGateway);
    this.refreshGatewayDevice(gatewayDevices);

    // Device families, each refreshed from its own deviceid details. Adding a
    // family is one entry here.
    const families: DeviceFamily[] = [
      {
        name: 'climate devices',
        devices: response.id.filter((d) => d.sIT600TH || d.sTherS),
        refresh: (details) => this.refreshClimateDevices(details),
      },
      {
        name: 'wiring centres',
        devices: response.id.filter((d) => d.sIT600WC || modelOf(d) === 'it600WC'),
        refresh: (details) => this.refreshWiringCentreDevices(details),
      },
      {
        name: 'binary sensors',
        devices: response.id.filter((d) =>
          d.sIASZS ||
          (d.sBasicS?.ModelIdentifier && BINARY_SENSOR_MODELS.includes(d.sBasicS.ModelIdentifier)),
        ),
        refresh: (details) => this.refreshBinarySensorDevices(details),
      },
      {
        name: 'sensors',
        devices: response.id.filter((d) => d.sTempS),
        refresh: (details) => this.refreshSensorDevices(details),
      },
      {
        name: 'switches',
        devices: response.id.filter((d) => d.sOnOffS),
        refresh: (details) => this.refreshSwitchDevices(details),
      },
      {
        name: 'covers',
        devices: response.id.filter((d) => d.sLevelS),
        refresh: (details) => this.refreshCoverDevices(details),
      },
    ];

    if (this.debug) {
      const counts = families.map((f) => `${f.name}=${f.devices.length}`).join(' ');
      console.log(`Poll: ${fromCache ? 'cached' : 'fresh'} readall, ${response.id.length} devices: ${counts}`);
    }

    this.usedCombined = false;
    const combined = this.combinedDetails ? await this.fetchCombinedDetails(families) : null;
    this.usedCombined = combined !== null;

    for (const family of families) {
      try {
        let details: ApiDeviceStatus[];
        if (combined) {
          details = family.devices.map((d) => combined.get(detailKey(d))).filter((d): d is ApiDeviceStatus => !!d);
          // Devices without a UniID cannot be in the combined request: ask per type.
          const unkeyed = family.devices.filter((d) => !d.data?.UniID);
          if (unkeyed.length > 0) details = details.concat(await this.fetchDeviceDetails(unkeyed));
        } else {
          details = await this.fetchDeviceDetails(family.devices);
        }
        family.refresh(details);
      } catch (e) {
        console.error(`Failed to poll ${family.name}:`, e);
      }
    }
  }

  /** Parse device name from JSON string */
  private parseDeviceName(deviceNameJson: string | undefined, fallback: string): string {
    return parseDeviceName(deviceNameJson, fallback);
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
        swVersion: device.sOTA?.OTAFirmwareVersion_d || device.sZDO?.FirmwareVersion || null,
      };
    }
  }

  /** Parse climate devices from batch response */
  private refreshClimateDevices(devices: ApiDeviceStatus[]): void {
    if (devices.length === 0) return;
    const newDevices = new Map<string, ClimateDevice>();

    for (const device of devices) {
      const uniqueId = device.data?.UniID;
      if (!uniqueId) continue;

      try {
        const parsed = parseClimateDevice(device, this.climateDevices.get(uniqueId));
        if (parsed) newDevices.set(uniqueId, parsed);
      } catch (err) {
        console.error(`Failed to parse climate device ${uniqueId}:`, err);
      }
    }

    this.climateDevices = newDevices;
  }

  /** Parse wiring centres from batch response */
  private refreshWiringCentreDevices(devices: ApiDeviceStatus[]): void {
    if (devices.length === 0) return;
    const newDevices = new Map<string, WiringCentreDevice>();

    for (const device of devices) {
      const uniqueId = device.data?.UniID;
      if (!uniqueId) continue;

      try {
        const parsed = parseWiringCentre(device, this.wiringCentreDevices.get(uniqueId));
        if (parsed) newDevices.set(uniqueId, parsed);
      } catch (err) {
        console.error(`Failed to parse wiring centre ${uniqueId}:`, err);
      }
    }

    this.wiringCentreDevices = newDevices;
  }

  /** Parse binary sensor devices from batch response */
  private refreshBinarySensorDevices(devices: ApiDeviceStatus[]): void {
    if (devices.length === 0) return;
    const newDevices = new Map<string, BinarySensorDevice>();

    for (const device of devices) {
      const uniqueId = device.data?.UniID;
      if (!uniqueId) continue;

      try {
        const model = device.DeviceL?.ModelIdentifier_i || null;

        // Skip buttons
        if (model && BUTTON_MODELS.includes(model)) continue;

        let isOn: boolean | null = null;
        if (model && BINARY_SENSOR_MODELS.includes(model)) {
          isOn = device.sIT600I?.RelayStatus === 1;
        } else if (device.sIASZS) {
          isOn = device.sIASZS.ErrorIASZSAlarmed1 === 1;
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
          available: (device.sZDOInfo?.OnlineStatus_i ?? 1) === 1,
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

  /** Parse temperature sensor devices from batch response */
  private refreshSensorDevices(devices: ApiDeviceStatus[]): void {
    if (devices.length === 0) return;
    const newDevices = new Map<string, SensorDevice>();

    for (const device of devices) {
      const uniqueId = device.data?.UniID;
      if (!uniqueId) continue;

      try {
        const temperature = device.sTempS?.MeasuredValue_x100;
        if (temperature === undefined) continue;

        const sensorId = `${uniqueId}_temp`;
        const model = device.DeviceL?.ModelIdentifier_i || null;

        const sensor: SensorDevice = {
          available: (device.sZDOInfo?.OnlineStatus_i ?? 1) === 1,
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

  /** Parse switch devices from batch response */
  private refreshSwitchDevices(devices: ApiDeviceStatus[]): void {
    if (devices.length === 0) return;
    const newDevices = new Map<string, SwitchDevice>();

    for (const device of devices) {
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
          available: (device.sZDOInfo?.OnlineStatus_i ?? 1) === 1,
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

  /** Parse cover devices from batch response */
  private refreshCoverDevices(devices: ApiDeviceStatus[]): void {
    if (devices.length === 0) return;
    const newDevices = new Map<string, CoverDevice>();

    for (const device of devices) {
      if (!device.sLevelS) continue;
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
          available: (device.sZDOInfo?.OnlineStatus_i ?? 1) === 1,
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

  getWiringCentreDevices(): Map<string, WiringCentreDevice> {
    return this.wiringCentreDevices;
  }

  getWiringCentreDevice(deviceId: string): WiringCentreDevice | undefined {
    return this.wiringCentreDevices.get(deviceId);
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
    else if (preset === PRESET_AWAY) holdType = 6;
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
