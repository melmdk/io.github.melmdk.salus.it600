/**
 * Live check of the Away preset. WRITES to one thermostat, "Gæsteværelse":
 * sets Away, waits for the gateway to report it, then restores the original preset
 * and setpoint (always, in a finally).
 * Usage: npx tsc -p tsconfig.test.json && node .test-build/scripts/check-away.js
 * Reads test-config.json ({ host, euid }); never prints the EUID.
 * Prints AWAY OK or AWAY FAIL: <reason>, then restored / NOT RESTORED.
 */
import * as fs from 'fs';
import * as path from 'path';
import { IT600Gateway } from '../lib/salus-api';
import type { ClimateDevice } from '../lib/device-types';
import { PRESET_AWAY, PRESET_FOLLOW_SCHEDULE, PRESET_PERMANENT_HOLD, PresetMode } from '../lib/constants';

const TARGET_NAME = 'Gæsteværelse';
const POLL_EVERY_MS = 3000;
const POLL_FOR_MS = 60000;
const RESTORE_ATTEMPTS = 6;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const root = path.resolve(__dirname, '../..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'test-config.json'), 'utf8')) as { host: string; euid: string };

function findTarget(gateway: IT600Gateway): ClimateDevice {
  const matches = [...gateway.getClimateDevices().values()].filter((d) => d.name === TARGET_NAME);
  if (matches.length !== 1) throw new Error(`expected exactly one thermostat named ${TARGET_NAME}, found ${matches.length}`);
  return matches[0];
}

async function main(): Promise<void> {
  const gateway = new IT600Gateway(config.euid, config.host);
  await gateway.connect();
  await gateway.pollStatus();
  const target = findTarget(gateway);
  const id = target.uniqueId;
  const originalSetpoint = target.targetTemperature;
  const originalPreset: PresetMode = target.presetMode;
  console.log(`baseline: ${TARGET_NAME} setpoint ${originalSetpoint}, preset ${originalPreset}, problems ${JSON.stringify(target.problems)}, rssi ${target.rssi}, lqi ${target.lqi}`);
  if (originalPreset !== PRESET_FOLLOW_SCHEDULE && originalPreset !== PRESET_PERMANENT_HOLD) {
    console.log(`AWAY FAIL: not run, preset "${originalPreset}" cannot be restored exactly`);
    process.exitCode = 1;
    return;
  }

  let result = `AWAY FAIL: presetMode did not become Away within ${POLL_FOR_MS / 1000} s`;
  // Set before the write: a write that times out may still have reached the gateway.
  let written = true;
  try {
    await gateway.setClimatePreset(id, PRESET_AWAY);
    console.log('wrote preset Away');
    const deadline = Date.now() + POLL_FOR_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_EVERY_MS);
      await gateway.pollStatus();
      const seen = findTarget(gateway);
      console.log(`poll: preset ${seen.presetMode}, setpoint ${seen.targetTemperature}`);
      if (seen.presetMode === PRESET_AWAY) { result = 'AWAY OK'; break; }
    }
  } catch (err) {
    result = `AWAY FAIL: ${(err as Error).message}`;
  } finally {
    console.log(result);
    if (result !== 'AWAY OK') process.exitCode = 1;
    if (written) {
      let ok = false;
      // Each restore is attempted on its own, so a failed one does not skip the other.
      try {
        await gateway.setClimatePreset(id, originalPreset);
      } catch (err) {
        console.log(`preset restore error: ${(err as Error).message}`);
      }
      try {
        await gateway.setClimateTemperature(id, originalSetpoint);
      } catch (err) {
        console.log(`setpoint restore error: ${(err as Error).message}`);
      }
      try {
        // The gateway needs a moment to report the restored values (up to ~18 s).
        for (let attempt = 0; attempt < RESTORE_ATTEMPTS && !ok; attempt += 1) {
          await sleep(3000);
          await gateway.pollStatus();
          const after = findTarget(gateway);
          ok = Math.abs(after.targetTemperature - originalSetpoint) < 0.01 && after.presetMode === originalPreset;
          console.log(`after restore: setpoint ${after.targetTemperature}, preset ${after.presetMode}`);
        }
      } catch (err) {
        console.log(`restore error: ${(err as Error).message}`);
      }
      console.log(ok ? 'restored' : 'NOT RESTORED: check the thermostat by hand');
      if (!ok) process.exitCode = 1;
    }
  }
}

main().catch((err) => { console.log(`AWAY FAIL: ${(err as Error).message}`); process.exitCode = 1; });
