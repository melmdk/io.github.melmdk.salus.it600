/**
 * Debug script to check if deviceid request returns BatteryLevel
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

async function main() {
  const configPath = path.join(__dirname, 'test-config.json');
  const config: TestConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const key = deriveKey(config.euid);

  console.log('Step 1: Get all devices (readall)...\n');

  const readallResponse = await makeRequest(config.host, key, 'read', { requestAttr: 'readall' }) as {
    id?: Array<Record<string, unknown>>;
  };

  // Find thermostats
  const thermostats = (readallResponse.id || []).filter((d: Record<string, unknown>) => d.sIT600TH);

  console.log(`Found ${thermostats.length} thermostats\n`);

  // Show battery from readall
  console.log('=== Battery from READALL ===');
  for (const t of thermostats) {
    const data = t.data as { UniID?: string };
    const th = t.sIT600TH as { BatteryLevel?: number };
    console.log(`  ${data?.UniID}: BatteryLevel = ${th?.BatteryLevel}`);
  }

  // Now do detailed request
  console.log('\nStep 2: Get detailed info (deviceid)...\n');

  const deviceidResponse = await makeRequest(config.host, key, 'read', {
    requestAttr: 'deviceid',
    id: thermostats.map((d) => ({ data: d.data })),
  }) as {
    id?: Array<Record<string, unknown>>;
  };

  console.log('=== Battery from DEVICEID ===');
  for (const t of deviceidResponse.id || []) {
    const data = t.data as { UniID?: string };
    const th = t.sIT600TH as { BatteryLevel?: number } | undefined;
    console.log(`  ${data?.UniID}: BatteryLevel = ${th?.BatteryLevel ?? 'MISSING'}`);
  }
}

main().catch(console.error);
