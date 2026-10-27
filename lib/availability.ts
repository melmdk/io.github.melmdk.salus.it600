/**
 * A device's availability as last applied to Homey, so devices call
 * setAvailable / setUnavailable only when it changes instead of on every
 * poll. No Homey runtime, so it can be unit tested.
 */

/** The part of a Homey device the tracker drives; a Homey.Device satisfies it. */
export interface AvailabilityTarget {
  setAvailable(): Promise<unknown>;
  setUnavailable(message?: string | null): Promise<unknown>;
}

export class AvailabilityTracker {
  /** null: available; a string: unavailable with that message; undefined: nothing applied yet. */
  private applied: string | null | undefined = undefined;

  /**
   * Record `reason` (null for available, else the unavailable message) and
   * say whether it differs from what was last applied, i.e. whether to call
   * setAvailable / setUnavailable now.
   */
  changed(reason: string | null): boolean {
    if (this.applied === reason) return false;
    this.applied = reason;
    return true;
  }

  /** Applying the last change failed: the next update applies it again. */
  forget(): void {
    this.applied = undefined;
  }

  /**
   * Make `device` available (null) or unavailable with `reason`, only when
   * that differs from what was last applied. A failed call is rethrown and
   * retried on the next update.
   */
  async update(device: AvailabilityTarget, reason: string | null): Promise<void> {
    if (!this.changed(reason)) return;
    try {
      await (reason === null ? device.setAvailable() : device.setUnavailable(reason));
    } catch (err) {
      this.forget();
      throw err;
    }
  }
}
