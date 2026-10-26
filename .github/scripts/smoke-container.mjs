import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:39273';
const headers = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  Authorization: 'Bearer ci-only-key',
};
let session;

async function request(method, params, id) {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      ...headers,
      ...(session ? { 'Mcp-Session-Id': session, 'MCP-Protocol-Version': '2025-11-25' } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  session ||= response.headers.get('mcp-session-id');
  const text = await response.text();
  if (id === undefined) {
    assert.equal(response.status, 202);
    return;
  }
  assert.equal(response.status, 200, text);
  const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
  const json = dataLine ? dataLine.slice(6) : text;
  const parsed = JSON.parse(json);
  assert.equal(parsed.id, id);
  assert.ok(!parsed.error, JSON.stringify(parsed.error));
  return parsed.result;
}

let ready = false;
for (let i = 0; i < 90; i++) {
  try {
    ready = (await fetch(`${base}/ready`, { signal: AbortSignal.timeout(2000) })).ok;
    if (ready) break;
  } catch { /* wait for the container */ }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(ready, 'fixture corpus must be ready');
assert.equal((await fetch(`${base}/mcp`, { method: 'POST' })).status, 401);
assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { ...headers, Origin: 'https://untrusted.example' } })).status, 403);
await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'container-smoke', version: '1' } }, 1);
assert.ok(session, 'initialize must return a session id');
await request('notifications/initialized', {}, undefined);
const tools = await request('tools/list', {}, 2);
assert.ok(tools.tools.some((tool) => tool.name === 'search_3gpp_docs'));
const result = await request('tools/call', { name: 'search_3gpp_docs', arguments: { query: 'attach reject' } }, 3);
const payload = JSON.parse(result.content[0].text);
assert.equal(payload.mode_actual, 'keyword');
assert.equal(payload.results[0].section_id, 'ts_24_301:1');
console.log('Container ready, auth/Origin gates, MCP initialization, and search passed.');
