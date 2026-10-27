/**
 * Live check of combined deviceid requests. WRITES to one thermostat, "Gæsteværelse":
 * setpoint +0.5 C, then restores the original setpoint and preset (always, in a finally).
 * Usage: npx tsc -p tsconfig.test.json && node .test-build/scripts/check-combined.js
 * Reads test-config.json ({ host, euid }); never prints the EUID.
 * Prints COMBINED OK or COMBINED FAIL: <reason>, then restored / NOT RESTORED.
 * Exits non-zero on COMBINED FAIL or NOT RESTORED.
 */
import * as fs from 'fs';
import * as path from 'path';
import { IT600Gateway } from '../lib/salus-api';
import type { ClimateDevice } from '../lib/device-types';
import { PRESET_FOLLOW_SCHEDULE, PRESET_PERMANENT_HOLD, PresetMode } from '../lib/constants';

const TARGET_NAME = 'Gæsteværelse';
const POLL_EVERY_MS = 5000;
const POLL_FOR_MS = 60000;
const REQUIRED_STREAK = 3;
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

  // Baseline over per-type requests (read-only).
  await gateway.pollStatus();
  const baselineCount = gateway.getClimateDevices().size;
  const target = findTarget(gateway);
  const id = target.uniqueId;
  const originalSetpoint = target.targetTemperature;
  const originalPreset: PresetMode = target.presetMode;
  console.log(`baseline: ${baselineCount} climate devices; ${TARGET_NAME} setpoint ${originalSetpoint}, preset ${originalPreset}`);
  if (originalPreset !== PRESET_FOLLOW_SCHEDULE && originalPreset !== PRESET_PERMANENT_HOLD) {
    console.log(`COMBINED FAIL: not run, preset "${originalPreset}" cannot be restored exactly`);
    process.exitCode = 1;
    return;
  }

  gateway.setCombinedDetailRequests(true);
  const newSetpoint = originalSetpoint + 0.5;
  let result = 'COMBINED FAIL: no 3 consecutive polls served by the combined request with the new setpoint within 60 s';
  // Set before the write: a write that times out may still have reached the gateway.
  let written = true;
  try {
    await gateway.setClimateTemperature(id, newSetpoint);
    console.log(`wrote setpoint ${newSetpoint}`);

    const deadline = Date.now() + POLL_FOR_MS;
    let streak = 0;
    while (Date.now() < deadline) {
      await sleep(POLL_EVERY_MS);
      await gateway.pollStatus();
      const count = gateway.getClimateDevices().size;
      const seen = findTarget(gateway).targetTemperature;
      console.log(`poll: combined=${gateway.combinedDetailRequests} devices=${count} setpoint=${seen}`);
      if (!gateway.combinedDetailRequests) { result = 'COMBINED FAIL: gateway switched combined requests off (rejected, left devices out or dropped)'; break; }
      if (count !== baselineCount) { result = `COMBINED FAIL: ${count} climate devices, expected ${baselineCount}`; break; }
      // A fallback poll also returns everything, so count only polls the combined request served.
      streak = gateway.lastPollUsedCombined && Math.abs(seen - newSetpoint) < 0.01 ? streak + 1 : 0;
      if (streak >= REQUIRED_STREAK) { result = 'COMBINED OK'; break; }
    }
  } catch (err) {
    result = `COMBINED FAIL: ${(err as Error).message}`;
  } finally {
    console.log(result);
    if (result !== 'COMBINED OK') process.exitCode = 1;
    if (written) {
      let ok = false;
      // Each restore is attempted on its own, so a failed setpoint does not skip the preset.
      try {
        await gateway.setClimateTemperature(id, originalSetpoint);
      } catch (err) {
        console.log(`setpoint restore error: ${(err as Error).message}`);
      }
      try {
        await gateway.setClimatePreset(id, originalPreset);
      } catch (err) {
        console.log(`preset restore error: ${(err as Error).message}`);
      }
      try {
        gateway.setCombinedDetailRequests(false);
        // The gateway needs a moment to report the restored values.
        for (let attempt = 0; attempt < 6 && !ok; attempt += 1) {
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
    } else {
      console.log('restored (nothing was written)');
    }
  }
}

main().catch((err) => { console.log(`COMBINED FAIL: ${(err as Error).message}`); process.exitCode = 1; });
