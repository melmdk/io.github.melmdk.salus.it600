/**
 * Dump raw data from Salus IT600 gateway.
 *
 * Usage: npx ts-node dump-connection.ts
 *
 * Requires test-config.json (gitignored) with:
 * { "host": "x.x.x.x", "euid": "xxxx" }
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as http from 'http';

interface TestConfig {
  host: string;
  euid: string;
}

const ENCRYPTION_IV = Buffer.from([
  0x88, 0xa6, 0xb0, 0x79, 0x5d, 0x85, 0xdb, 0xfc,
  0xe6, 0xe0, 0xb3, 0xe9, 0xa6, 0x29, 0x65, 0x4b,
]);

function deriveKey(euid: string): Buffer {
  const hash = crypto.createHash('md5')
    .update(`Salus-${euid.toLowerCase()}`)
    .digest();
  return Buffer.concat([hash, Buffer.alloc(16)]);
}

function encrypt(plain: string, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-256-cbc', key, ENCRYPTION_IV);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
}

function decrypt(encrypted: Buffer, key: Buffer): string {
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, ENCRYPTION_IV);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

async function makeRequest(host: string, key: Buffer, command: string, body: object): Promise<unknown> {
  const url = `/deviceid/${command}`;
  const bodyJson = JSON.stringify(body);
  const encryptedBody = encrypt(bodyJson, key);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: host,
        port: 80,
        path: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': encryptedBody.length,
        },
        timeout: 10000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const decrypted = decrypt(Buffer.concat(chunks), key);
            resolve(JSON.parse(decrypted));
          } catch (err) {
            reject(err);
          }
        });
        res.on('error', reject);
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });

    req.write(encryptedBody);
    req.end();
  });
}

function parseDeviceName(deviceNameJson: string | undefined): string {
  if (!deviceNameJson) return 'Unknown';
  try {
    const parsed = JSON.parse(deviceNameJson) as { deviceName?: string };
    return parsed.deviceName || 'Unknown';
  } catch {
    return deviceNameJson;
  }
}

async function main() {
  const configPath = path.join(__dirname, 'test-config.json');

  if (!fs.existsSync(configPath)) {
    console.error('Missing test-config.json. Create it with:');
    console.error('{ "host": "x.x.x.x", "euid": "xxxx" }');
    process.exit(1);
  }

  const config: TestConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log(`Connecting to gateway at ${config.host}...\n`);

  const key = deriveKey(config.euid);

  try {
    // Get all devices
    const response = await makeRequest(config.host, key, 'read', { requestAttr: 'readall' }) as {
      status: string;
      id?: Array<Record<string, unknown>>;
    };

    if (response.status !== 'success') {
      throw new Error(`Gateway returned status: ${response.status}`);
    }

    const devices = response.id || [];
    console.log(`Found ${devices.length} device(s)\n`);
    console.log('='.repeat(80));

    for (const device of devices) {
      const data = device.data as { UniID?: string };
      const uniqueId = data?.UniID || 'unknown';

      // Determine device type
      let deviceType = 'Unknown';
      if (device.sGateway) deviceType = 'Gateway';
      else if (device.sIT600TH || device.sTherS) deviceType = 'Thermostat';
      else if (device.sTempS) deviceType = 'Temperature Sensor';
      else if (device.sIASZS) deviceType = 'Binary Sensor';
      else if (device.sOnOffS) deviceType = 'Switch';
      else if (device.sLevelS) deviceType = 'Cover';

      // Get device name
      const sZDO = device.sZDO as { DeviceName?: string; FirmwareVersion?: string } | undefined;
      const name = parseDeviceName(sZDO?.DeviceName);

      console.log(`\n[${deviceType}] ${name} (${uniqueId})`);
      console.log('-'.repeat(80));

      // Print all attributes
      for (const [key, value] of Object.entries(device)) {
        if (key === 'data') {
          console.log(`  ${key}: ${JSON.stringify(value)}`);
        } else if (typeof value === 'object' && value !== null) {
          console.log(`  ${key}:`);
          for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
            console.log(`    ${subKey}: ${JSON.stringify(subValue)}`);
          }
        } else {
          console.log(`  ${key}: ${JSON.stringify(value)}`);
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n✓ Dump completed successfully!');

  } catch (err) {
    console.error('\n✗ Error:', err);
    process.exit(1);
  }
}

main();
