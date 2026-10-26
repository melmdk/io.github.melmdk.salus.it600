/**
 * Live check of combined deviceid requests. WRITES to one thermostat, "Gæsteværelse":
 * setpoint +0.5 C, then restores the original setpoint and preset (always, in a finally).
 * Usage: npx tsc -p tsconfig.test.json && node .test-build/scripts/check-combined.js
 * Reads test-config.json ({ host, euid }); never prints the EUID.
 * Prints COMBINED OK or COMBINED FAIL: <reason>, then restored / NOT RESTORED.
 */
import * as fs from 'fs';
import * as path from 'path';
import { IT600Gateway } from '../lib/salus-api';
import type { ClimateDevice } from '../lib/device-types';
import { PRESET_FOLLOW_SCHEDULE, PRESET_PERMANENT_HOLD, PresetMode } from '../lib/constants';

const TARGET_NAME = 'Gæsteværelse';
const POLL_EVERY_MS = 5000;
const POLL_FOR_MS = 60000;
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
    return;
  }

  gateway.setCombinedDetailRequests(true);
  const newSetpoint = originalSetpoint + 0.5;
  let result = 'COMBINED FAIL: new setpoint never appeared within 60 s';
  let written = false;
  try {
    await gateway.setClimateTemperature(id, newSetpoint);
    written = true;
    console.log(`wrote setpoint ${newSetpoint}`);

    const deadline = Date.now() + POLL_FOR_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_EVERY_MS);
      await gateway.pollStatus();
      const count = gateway.getClimateDevices().size;
      const seen = findTarget(gateway).targetTemperature;
      console.log(`poll: combined=${gateway.combinedDetailRequests} devices=${count} setpoint=${seen}`);
      if (!gateway.combinedDetailRequests) { result = 'COMBINED FAIL: gateway switched combined requests off (rejected, left devices out or dropped)'; break; }
      if (count !== baselineCount) { result = `COMBINED FAIL: ${count} climate devices, expected ${baselineCount}`; break; }
      if (Math.abs(seen - newSetpoint) < 0.01) { result = 'COMBINED OK'; break; }
    }
  } catch (err) {
    result = `COMBINED FAIL: ${(err as Error).message}`;
  } finally {
    console.log(result);
    if (written) {
      let ok = false;
      try {
        await gateway.setClimateTemperature(id, originalSetpoint);
        await gateway.setClimatePreset(id, originalPreset);
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
    } else {
      console.log('restored (nothing was written)');
    }
  }
}

main().catch((err) => { console.log(`COMBINED FAIL: ${(err as Error).message}`); process.exitCode = 1; });
