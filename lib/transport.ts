/**
 * HTTP transport to the gateway. Kept separate from the API client so tests can
 * substitute an in-memory gateway.
 */

import * as http from 'http';

/** POST `body` to `path` and resolve with the raw response bytes. */
export type Transport = ((path: string, body: Buffer) => Promise<Buffer>) & {
  /** Resolve if anything answers `GET /` on the gateway; reject otherwise. */
  probeRoot?: () => Promise<void>;
};

/** Thrown by transports on network errors and timeouts. */
export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportError';
  }
}

export function httpTransport(host: string, port: number, timeoutMs: number): Transport {
  const transport: Transport = (path, body) => new Promise<Buffer>((resolve, reject) => {
    const req = http.request(
      {
        hostname: host,
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      },
    );
    req.on('error', (err) => reject(new TransportError(`Error communicating with gateway: ${err.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new TransportError('Gateway request timeout'));
    });
    req.write(body);
    req.end();
  });

  transport.probeRoot = () => new Promise<void>((resolve, reject) => {
    const req = http.get({ hostname: host, port, path: '/', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve();
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new TransportError('Gateway request timeout'));
    });
  });

  return transport;
}
