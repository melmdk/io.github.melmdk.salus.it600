import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProtocol } from '../lib/protocol';
import type { ApiResponse } from '../lib/device-types';
import { loadFixture } from './helpers/fixtures';
import { fakeGateway } from './helpers/fake-gateway';

const EUID = '0123456789ABCDEF';

test('loadFixture names the missing fixture and lists the available ones', () => {
  // This gateway has no binary sensors, so no deviceid-binary fixture was captured.
  assert.throws(() => loadFixture('deviceid-binary'), (err: Error) => {
    assert.match(err.message, /No fixture "deviceid-binary"/);
    assert.match(err.message, /available: .*deviceid-climate.*readall/);
    assert.doesNotMatch(err.message, /ENOENT/);
    return true;
  });
});

/** Send one `deviceid` request for `ids` to the fake and decode its answer. */
async function askDetails(transport: ReturnType<typeof fakeGateway>, ids: string[]): Promise<ApiResponse> {
  const client = createProtocol('aes-256-cbc', EUID);
  const body = { requestAttr: 'deviceid', id: ids.map((UniID) => ({ data: { UniID } })) };
  const raw = await transport('/deviceid/read', client.wrapRequest(JSON.stringify(body)));
  return JSON.parse(client.unwrapResponse(raw)) as ApiResponse;
}

test("fakeGateway 'omit' without a detailPool leaves the last requested device out", async () => {
  const deviceid = {
    status: 'success',
    id: [{ data: { UniID: 'a' } }, { data: { UniID: 'b' } }],
  } as unknown as ApiResponse;
  const transport = fakeGateway({
    protocol: 'aes-256-cbc', euid: EUID, fixtures: { deviceid }, onDetails: () => 'omit',
  });
  const answer = await askDetails(transport, ['a', 'b']);
  assert.deepEqual(answer.id?.map((entry) => entry.data.UniID), ['a']);
});

test("fakeGateway 'truncate' without a detailPool sends half a frame", async () => {
  const deviceid = { status: 'success', id: [{ data: { UniID: 'a' } }] } as unknown as ApiResponse;
  const transport = fakeGateway({
    protocol: 'aes-256-cbc', euid: EUID, fixtures: { deviceid }, onDetails: () => 'truncate',
  });
  // Half a CBC frame fails the padding check (or, rarely, leaves truncated JSON).
  await assert.rejects(askDetails(transport, ['a']), /bad decrypt|JSON/);
});
