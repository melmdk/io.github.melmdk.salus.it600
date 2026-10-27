/**
 * The app's one gateway connection, without the Homey runtime so it can be
 * unit tested: connects run one at a time, a failed connect keeps the
 * previous gateway, the poll loop reconnects on its own, and the outcome of
 * each connect is written to `gateway_status`.
 *
 * Settings keys: `gateway` (persisted connection), `gateway_input` (written by
 * the settings page) and `gateway_status` (user-facing text only; never the
 * EUID).
 */

import {
  connectedSettings, connectionErrorMessage, inputCombinedDetails, migrateGatewaySettings,
} from './gateway-settings';
import type { GatewaySettings, GatewayStatus } from './gateway-settings';
import type { ProtocolName } from './protocol';

/** The part of Homey's settings manager the connection uses. */
export interface SettingsStore {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
}

/** Where the connection logs (the Homey app's log/error). */
export interface ConnectionLogger {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** What the connection needs from a gateway client; IT600Gateway satisfies it. */
export interface ManagedGateway {
  connect(): Promise<{ protocol: ProtocolName }>;
  setCombinedDetailRequests(enabled: boolean): void;
  pollStatus(): Promise<void>;
}

/** Host, EUID and the protocol to try first (when one is known) for one connect attempt. */
export interface ConnectTarget {
  host: string;
  euid: string;
  protocol?: ProtocolName;
}

export interface GatewayConnectionOptions<G extends ManagedGateway> {
  settings: SettingsStore;
  logger: ConnectionLogger;
  /** Build a fresh client for one connect attempt. */
  createGateway: (target: ConnectTarget) => G;
  /** Called after every successful poll, so devices update. */
  onDevicesUpdated: () => void;
}

export class GatewayConnection<G extends ManagedGateway> {
  private gateway: G | null = null;
  /** Connects run one at a time, so two gateway instances never race each other. */
  private connectQueue: Promise<unknown> = Promise.resolve();
  private pendingConnects = 0;
  private readonly settings: SettingsStore;
  private readonly logger: ConnectionLogger;
  private readonly createGateway: (target: ConnectTarget) => G;
  private readonly onDevicesUpdated: () => void;

  constructor(opts: GatewayConnectionOptions<G>) {
    this.settings = opts.settings;
    this.logger = opts.logger;
    this.createGateway = opts.createGateway;
    this.onDevicesUpdated = opts.onDevicesUpdated;
  }

  /** The connected gateway, or null while there is none. */
  getGateway(): G | null {
    return this.gateway;
  }

  /** The saved connection in the current shape, read from any shape older versions stored. */
  loadSettings(): GatewaySettings | null {
    return migrateGatewaySettings(
      this.settings.get('gateway'),
      this.settings.get('host'),
      this.settings.get('euid'),
    );
  }

  /** IP of the saved gateway, or null before first setup. */
  getSavedHost(): string | null {
    return this.loadSettings()?.host ?? null;
  }

  /**
   * Store older versions' settings in the current shape. Writes `gateway` only
   * when the stored value differs. Returns the settings, or null before first setup.
   */
  migrateStoredSettings(): GatewaySettings | null {
    const settings = this.loadSettings();
    if (settings && JSON.stringify(this.settings.get('gateway')) !== JSON.stringify(settings)) {
      this.settings.set('gateway', settings);
    }
    return settings;
  }

  /**
   * App start: migrate the settings, connect to the saved gateway and poll
   * once. A failure is logged and left to the poll loop, which keeps retrying.
   */
  async start(): Promise<void> {
    const settings = this.migrateStoredSettings();
    if (!settings) return;

    this.logger.log(`Connecting to gateway at ${settings.host}`);
    try {
      await this.connect(settings.host, settings.euid);
      await this.refreshDevices();
    } catch (err) {
      this.logger.error('Initial gateway connection failed, will retry via polling:', err);
    }
  }

  /**
   * Connect (or reconnect) the app-level gateway. Normalises the EUID, tries
   * the stored protocol first (connect() re-detects when its answer can't be
   * decrypted or is rejected; a network error on the stored protocol fails
   * the connect without re-detecting), persists
   * `{host, euid, protocol, combinedDetails}` and writes `gateway_status`.
   * `combinedDetails` is the settings page choice; without it the stored
   * preference is kept. On failure the API error is thrown and the previous
   * gateway stays in use.
   */
  connect(host: string, euid: string, combinedDetails?: boolean): Promise<G> {
    return this.queueConnect(host, euid, true, combinedDetails);
  }

  /** The settings page saved IP and EUID as one change (`gateway_input`): reconnect once with the pair. */
  async applyInput(raw: unknown): Promise<void> {
    // Same validation and normalisation as stored settings.
    const input = migrateGatewaySettings(raw);
    if (!input) {
      this.logger.error('Ignoring incomplete gateway settings from the settings page');
      return;
    }

    this.logger.log(`Gateway settings changed, connecting to ${input.host}`);
    try {
      await this.connect(input.host, input.euid, inputCombinedDetails(raw));
      await this.refreshDevices();
      this.logger.log('Gateway reconnected with new settings');
    } catch (err) {
      this.logger.error('Failed to connect with new gateway settings:', err);
    }
  }

  /**
   * One poll-loop tick: reconnect when there is no gateway, then poll. A
   * failed poll drops the gateway so the next tick reconnects, unless a
   * connect replaced it meanwhile. Never throws.
   */
  async pollOnce(): Promise<void> {
    // A connect in progress is replacing the gateway; the next tick polls it.
    if (this.pendingConnects > 0) return;

    let polled: G | null = null;
    try {
      if (!this.gateway) {
        const settings = this.loadSettings();
        if (!settings) return;

        this.logger.log(`Gateway offline, attempting reconnect to ${settings.host}...`);
        // Same path as connect(): stored protocol first, re-detect when it
        // can't be decrypted or is rejected (not on a network error).
        await this.queueConnect(settings.host, settings.euid, false);
        this.logger.log('Gateway reconnected');
      }

      polled = this.gateway;
      await this.refreshDevices();
    } catch (err) {
      this.logger.error('Polling error:', err);
      // Drop the gateway so the next tick reconnects, unless a connect replaced it meanwhile.
      if (this.gateway === polled) this.gateway = null;
    }
  }

  /** Poll the gateway now and tell devices to update. No-op without a gateway. */
  async refreshDevices(): Promise<void> {
    const { gateway } = this;
    if (!gateway) return;
    await gateway.pollStatus();
    this.onDevicesUpdated();
  }

  private queueConnect(host: string, euid: string, alwaysReport: boolean, combinedDetails?: boolean): Promise<G> {
    this.pendingConnects += 1;
    const run = this.connectQueue.then(() => this.openGateway(host, euid, alwaysReport, combinedDetails));
    this.connectQueue = run.catch(() => undefined);
    return run.finally(() => {
      this.pendingConnects -= 1;
    });
  }

  private async openGateway(
    host: string, euid: string, alwaysReport: boolean, combinedDetails?: boolean,
  ): Promise<G> {
    const previous = this.loadSettings();
    const attempt = connectedSettings(previous, host, euid, undefined, combinedDetails);
    const gateway = this.createGateway({ host: attempt.host, euid: attempt.euid, protocol: attempt.protocol });

    let detected: ProtocolName;
    try {
      ({ protocol: detected } = await gateway.connect());
    } catch (err) {
      // Pairing and repair have no logger of their own; the poll loop logs its own failures.
      if (alwaysReport) this.logger.error(`Connecting to gateway at ${attempt.host} failed:`, err);
      this.writeStatus(false, connectionErrorMessage(err), alwaysReport);
      throw err;
    }

    const settings = connectedSettings(previous, attempt.host, attempt.euid, detected, combinedDetails);
    // The in-session fallback (rejected / left out / dropped) is never persisted.
    gateway.setCombinedDetailRequests(settings.combinedDetails !== false);
    this.gateway = gateway;
    this.settings.set('gateway', settings);
    this.writeStatus(true, `Connected to ${settings.host}`, alwaysReport);
    this.logger.log(`Connected to gateway at ${settings.host} (${detected}, combined detail requests ${settings.combinedDetails ? 'on' : 'off'})`);
    return gateway;
  }

  /** Write `gateway_status`; background reconnects only write when the outcome changes. */
  private writeStatus(ok: boolean, message: string, always: boolean): void {
    const current = this.settings.get('gateway_status') as GatewayStatus | null;
    if (!always && current?.ok === ok && current?.message === message) return;
    const status: GatewayStatus = { ok, message, at: new Date().toISOString() };
    this.settings.set('gateway_status', status);
  }
}
