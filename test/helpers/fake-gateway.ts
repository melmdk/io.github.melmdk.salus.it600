import { createProtocol, ProtocolName } from '../../lib/protocol';
import { TransportError, Transport } from '../../lib/transport';
import type { ApiResponse } from '../../lib/device-types';

export interface FakeGatewayOptions {
  /** Protocol the fake gateway speaks. */
  protocol: ProtocolName;
  /** EUID the fake gateway was provisioned with (its real key). */
  euid: string;
  /** Responses keyed by requestAttr (e.g. `readall`). */
  fixtures: Record<string, ApiResponse>;
  /** Fail this many requests with a network error before answering. */
  failFirst?: number;
  /** Answer every decryptable request with `{"status":"fail"}`. */
  reject?: boolean;
  /** Nothing answers: requests and the root probe both fail. */
  unreachable?: boolean;
}

export type FakeTransport = Transport & { requests: string[] };

/**
 * In-memory gateway. Like the real one, a request it cannot decrypt gets a
 * `{"status":"fail"}` frame encrypted with the gateway's own key, so a client
 * with the wrong key sees a decrypt failure, not a readable rejection.
 */
export function fakeGateway(opts: FakeGatewayOptions): FakeTransport {
  const gateway = createProtocol(opts.protocol, opts.euid);
  let failures = opts.failFirst ?? 0;
  const failFrame = (): Buffer => gateway.wrapRequest(JSON.stringify({ status: 'fail' }));

  const transport = (async (path: string, body: Buffer): Promise<Buffer> => {
    transport.requests.push(path);
    if (opts.unreachable) throw new TransportError('Gateway request timeout');
    if (failures > 0) {
      failures -= 1;
      throw new TransportError('Error communicating with gateway: ECONNRESET');
    }

    let request: { requestAttr?: string };
    try {
      request = JSON.parse(gateway.unwrapResponse(body)) as { requestAttr?: string };
    } catch {
      return failFrame();
    }
    if (opts.reject) return failFrame();

    const response: ApiResponse = path.endsWith('/write')
      ? ({ status: 'success' } as ApiResponse)
      : opts.fixtures[request.requestAttr ?? ''] ?? ({ status: 'success', id: [] } as ApiResponse);
    return gateway.wrapRequest(JSON.stringify(response));
  }) as FakeTransport;

  transport.requests = [];
  transport.probeRoot = async () => {
    if (opts.unreachable) throw new TransportError('Gateway request timeout');
  };
  return transport;
}
