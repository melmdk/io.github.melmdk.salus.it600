/**
 * Test script for Salus IT600 gateway connection.
 *
 * Usage: npx ts-node test-connection.ts
 *
 * Requires test-config.json (gitignored) with:
 * { "host": "x.x.x.x", "euid": "xxxx" }
 */

import * as fs from 'fs';
import * as path from 'path';
import { IT600Gateway } from './lib/salus-api';

interface TestConfig {
  host: string;
  euid: string;
}

async function main() {
  // Load config
  const configPath = path.join(__dirname, 'test-config.json');

  if (!fs.existsSync(configPath)) {
    console.error('Missing test-config.json. Create it with:');
    console.error('{ "host": "x.x.x.x", "euid": "xxxx" }');
    process.exit(1);
  }

  const config: TestConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log(`Connecting to gateway at ${config.host}...`);

  const gateway = new IT600Gateway(config.euid, config.host, 80, 10000, false);

  try {
    // Connect
    const mac = await gateway.connect();
    console.log(`\n✓ Connected! Gateway MAC: ${mac}\n`);

    // Poll devices
    await gateway.pollStatus();

    // Show gateway info
    const gw = gateway.getGatewayDevice();
    if (gw) {
      console.log('Gateway:');
      console.log(`  Model: ${gw.model}`);
      console.log(`  Firmware: ${gw.swVersion}`);
      console.log('');
    }

    // Show thermostats
    const climateDevices = gateway.getClimateDevices();
    if (climateDevices.size > 0) {
      console.log(`Thermostats (${climateDevices.size}):`);
      climateDevices.forEach((device, id) => {
        const isHeating = device.hvacAction === 'heating';
        const heatingStatus = isHeating ? '🔥 HEATING' : '❄️ Idle';
        const batteryStr = device.batteryLevel !== null ? `Battery: ${device.batteryLevel}/5` : '';
        console.log(`  [${id}] ${device.name}`);
        console.log(`    Current: ${device.currentTemperature}°C → Target: ${device.targetTemperature}°C`);
        console.log(`    Status: ${heatingStatus} | Mode: ${device.hvacMode} | Preset: ${device.presetMode}`);
        if (batteryStr) console.log(`    ${batteryStr}`);
        console.log(`    Model: ${device.model || 'Unknown'} | Firmware: ${device.swVersion || 'Unknown'}`);
        console.log(`    Available: ${device.available}`);
      });
      console.log('');
    }

    // Show temperature sensors
    const sensors = gateway.getSensorDevices();
    if (sensors.size > 0) {
      console.log(`Temperature Sensors (${sensors.size}):`);
      sensors.forEach((device, id) => {
        console.log(`  [${id}] ${device.name}: ${device.state}°C`);
      });
      console.log('');
    }

    // Show binary sensors
    const binarySensors = gateway.getBinarySensorDevices();
    if (binarySensors.size > 0) {
      console.log(`Binary Sensors (${binarySensors.size}):`);
      binarySensors.forEach((device, id) => {
        console.log(`  [${id}] ${device.name}: ${device.isOn ? 'OPEN/ON' : 'CLOSED/OFF'} (${device.deviceClass})`);
      });
      console.log('');
    }

    // Show switches
    const switches = gateway.getSwitchDevices();
    if (switches.size > 0) {
      console.log(`Switches (${switches.size}):`);
      switches.forEach((device, id) => {
        console.log(`  [${id}] ${device.name}: ${device.isOn ? 'ON' : 'OFF'}`);
      });
      console.log('');
    }

    // Show covers
    const covers = gateway.getCoverDevices();
    if (covers.size > 0) {
      console.log(`Covers (${covers.size}):`);
      covers.forEach((device, id) => {
        console.log(`  [${id}] ${device.name}: ${device.currentPosition}%`);
      });
      console.log('');
    }

    console.log('✓ Test completed successfully!');

  } catch (err) {
    console.error('\n✗ Error:', err);
    process.exit(1);
  }
}

main();
