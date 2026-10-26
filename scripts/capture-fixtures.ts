/**
 * Captures real gateway responses (read-only) into test/fixtures (sanitised)
 * and test/local (raw encrypted bytes, git-ignored).
 * Usage: npm run capture   (needs test-config.json with { host, euid })
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { ENCRYPTION_IV, BINARY_SENSOR_MODELS } from '../lib/constants';
import { sanitiseGatewayPayload, IdMap } from '../test/helpers/sanitise';
import type { ApiResponse } from '../lib/device-types';

type Dev = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const root = path.resolve(__dirname, '../..');
const fixtureDir = path.join(root, 'test/fixtures');
const localDir = path.join(root, 'test/local');
const config = JSON.parse(fs.readFileSync(path.join(root, 'test-config.json'), 'utf8')) as { host: string; euid: string };
const key = Buffer.concat([
  crypto.createHash('md5').update(`Salus-${config.euid.toLowerCase()}`).digest(),
  Buffer.alloc(16),
]);

function encrypt(plain: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-256-cbc', key, ENCRYPTION_IV);
  return Buffer.concat([cipher.update(plain), cipher.final()]);
}

function decrypt(raw: Buffer): ApiResponse {
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, ENCRYPTION_IV);
  return JSON.parse(Buffer.concat([decipher.update(raw), decipher.final()]).toString('utf8')) as ApiResponse;
}

function post(body: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: config.host,
        port: 80,
        path: '/deviceid/read',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
        timeout: 10000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function request(name: string, body: Record<string, unknown>): Promise<ApiResponse> {
  const raw = await post(encrypt(Buffer.from(JSON.stringify(body), 'utf8')));
  fs.writeFileSync(path.join(localDir, `${name}.bin`), raw);
  console.log(`${name}: ${raw.length} bytes`);
  const response = decrypt(raw);
  if (response.status !== 'success') throw new Error(`${name}: status ${response.status}`);
  return response;
}

const deviceIds: IdMap = new Map(); // shared so ids stay consistent across fixtures (readall is saved first)

function saveFixture(name: string, payload: ApiResponse): void {
  // The gateway reports its EUID as its own MACAddress; scrub it wherever it appears.
  const text = JSON.stringify(sanitiseGatewayPayload(payload, deviceIds), null, 2)
    .replace(new RegExp(config.euid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'REDACTED');
  fs.writeFileSync(path.join(fixtureDir, `${name}.json`), `${text}\n`);
}

// Mirrors the filters in IT600Gateway.pollStatus(), plus the wiring centre.
const families: Record<string, (d: Dev) => boolean> = {
  climate: (d) => Boolean(d.sIT600TH || d.sTherS),
  binary: (d) => Boolean(d.sIASZS || (d.sBasicS?.ModelIdentifier && BINARY_SENSOR_MODELS.includes(d.sBasicS.ModelIdentifier))),
  temp: (d) => Boolean(d.sTempS),
  switch: (d) => Boolean(d.sOnOffS),
  cover: (d) => Boolean(d.sLevelS),
  'wiring-centre': (d) => Boolean(d.sIT600WC || (d.DeviceL?.ModelIdentifier_i ?? d.sBasicS?.ModelIdentifier) === 'it600WC'),
};

async function main(): Promise<void> {
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.mkdirSync(localDir, { recursive: true });

  const readall = await request('readall', { requestAttr: 'readall' });
  saveFixture('readall', readall);
  const devices = (readall.id ?? []) as Dev[];
  const combined = new Set<Dev>();

  for (const [family, matches] of Object.entries(families)) {
    const members = devices.filter(matches);
    if (members.length === 0) {
      console.log(`${family}: EMPTY`);
      continue;
    }
    members.forEach((d) => combined.add(d));
    const response = await request(`deviceid-${family}`, { requestAttr: 'deviceid', id: members.map((d) => ({ data: d.data })) });
    saveFixture(`deviceid-${family}`, response);
  }

  if (combined.size > 0) {
    const response = await request('deviceid-combined', { requestAttr: 'deviceid', id: [...combined].map((d) => ({ data: d.data })) });
    saveFixture('deviceid-combined', response);
  }

  // Deliberately undecryptable body, to record the gateway's reject framing.
  const reject = await post(Buffer.from('x'));
  fs.writeFileSync(path.join(localDir, 'reject-frame.bin'), reject);
  console.log(`reject-frame: ${reject.length} bytes`);
}

main().catch((err: Error) => { console.error(err.message); process.exit(1); });
