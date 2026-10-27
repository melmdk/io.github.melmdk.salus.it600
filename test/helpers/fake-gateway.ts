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
  /**
   * What a request the gateway cannot decrypt gets: a `{"status":"fail"}`
   * frame under the gateway's key (the default, like the real UGE600), a
   * dropped connection, or an empty answer.
   */
  undecryptable?: 'fail-frame' | 'drop' | 'empty';
  /**
   * Entries `deviceid` requests are answered from: each answer holds the pool
   * entries whose UniID was asked for. Without it the entries of
   * `fixtures.deviceid` are answered whatever was asked for.
   */
  detailPool?: ApiResponse[];
  /**
   * Decide per `deviceid` request: answer it, reject it, leave the last
   * requested device out of the answer, drop the connection, send only
   * the first half of the answer frame, or answer `success` with an `id`
   * that is not a list. Works with and without `detailPool`.
   * `callIndex` counts `deviceid` requests from 0.
   */
  onDetails?: (ids: string[], callIndex: number) => DetailsOutcome;
}

/** What the gateway does with one `deviceid` request. */
export type DetailsOutcome = 'ok' | 'reject' | 'omit' | 'drop' | 'truncate' | 'malformed';

export type FakeTransport = Transport & {
  requests: string[];
  /** Decoded `requestAttr` of every request, in order. */
  attrs: string[];
  /** UniIDs asked for in every `deviceid` request, in order. */
  detailRequests: string[][];
  /** Decoded body of every `write` request, in order. */
  writes: Array<{ id?: Array<Record<string, unknown>> }>;
};

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

    let request: { requestAttr?: string; id?: Array<{ data?: { UniID?: string } } & Record<string, unknown>> };
    try {
      request = JSON.parse(gateway.unwrapResponse(body)) as typeof request;
    } catch {
      if (opts.undecryptable === 'drop') throw new TransportError('Error communicating with gateway: ECONNRESET');
      if (opts.undecryptable === 'empty') return Buffer.alloc(0);
      return failFrame();
    }
    if (opts.reject) return failFrame();
    transport.attrs.push(request.requestAttr ?? '');
    if (request.requestAttr === 'write') transport.writes.push(request);

    if (request.requestAttr === 'deviceid') {
      const ids = (request.id ?? []).map((item) => item.data?.UniID ?? '');
      transport.detailRequests.push(ids);
      const outcome = opts.onDetails?.(ids, transport.detailRequests.length - 1) ?? 'ok';
      if (outcome === 'drop') throw new TransportError('Error communicating with gateway: ECONNRESET');
      if (outcome === 'reject') return failFrame();
      if (outcome === 'malformed') return gateway.wrapRequest(JSON.stringify({ status: 'success', id: {} }));
      let entries = opts.detailPool
        ? opts.detailPool.flatMap((r) => r.id ?? []).filter((e) => ids.includes(e.data?.UniID))
        : opts.fixtures.deviceid?.id ?? [];
      if (outcome === 'omit') {
        const left = ids[ids.length - 1];
        entries = entries.filter((e) => e.data?.UniID !== left);
      }
      const frame = gateway.wrapRequest(JSON.stringify({ status: 'success', id: entries }));
      return outcome === 'truncate' ? frame.subarray(0, Math.floor(frame.length / 2)) : frame;
    }

    const response: ApiResponse = path.endsWith('/write')
      ? ({ status: 'success' } as ApiResponse)
      : opts.fixtures[request.requestAttr ?? ''] ?? ({ status: 'success', id: [] } as ApiResponse);
    return gateway.wrapRequest(JSON.stringify(response));
  }) as FakeTransport;

  transport.requests = [];
  transport.attrs = [];
  transport.detailRequests = [];
  transport.writes = [];
  transport.probeRoot = async () => {
    if (opts.unreachable) throw new TransportError('Gateway request timeout');
  };
  return transport;
}
