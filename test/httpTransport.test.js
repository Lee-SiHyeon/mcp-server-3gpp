import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { initDatabase } from '../src/db/schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '3gpp-http-test-'));
const dbPath = path.join(dir, 'fixture.db');
const processes = new Set();
const key = 'fixture-only-key';
const allowedOrigin = 'https://allowed.example';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startServer(overrides = {}) {
  const port = await freePort();
  const processEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: os.tmpdir(),
    NODE_ENV: 'production',
    API_KEY: key,
    HOST: '127.0.0.1',
    PORT: String(port),
    CORS_ORIGIN: allowedOrigin,
    MAX_SESSIONS: '1',
    SESSION_TTL_MS: '1000',
    THREEGPP_DB_PATH: dbPath,
    THREEGPP_DISABLE_SEMANTIC: 'true',
    ...overrides,
  };
  const child = spawn(process.execPath, [path.join(root, 'src/http.js')], {
    cwd: root, env: processEnv, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  processes.add(child);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`HTTP server exited: ${stderr}`);
    try {
      if ((await fetch(`${base}/health`)).ok) return { child, base };
    } catch { /* wait for the child to listen */ }
    await delay(100);
  }
  throw new Error(`HTTP server failed to start: ${stderr}`);
}

async function stopServer(child) {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  processes.delete(child);
}

const init = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } },
};
const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${key}` };

before(() => {
  const { db } = initDatabase(dbPath);
  db.prepare('INSERT INTO specs(id,title,version) VALUES(?,?,?)').run('ts_24_301', 'Fixture specification', 'v1');
  db.prepare('INSERT INTO sections(id,spec_id,section_number,section_title,content,content_length) VALUES(?,?,?,?,?,?)')
    .run('ts_24_301:1', 'ts_24_301', '1', 'Attach reject', 'Fixture attach reject information.', 34);
  db.close();
});

after(async () => {
  await Promise.all([...processes].map(stopServer));
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Streamable HTTP deployment', () => {
  test('auth, Origin, readiness, and a real MCP search', async (t) => {
    const { child, base } = await startServer();
    t.after(() => stopServer(child));
    assert.equal((await fetch(`${base}/ready`)).status, 200);
    assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init) })).status, 401);
    assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { ...headers, Origin: 'https://bad.example' }, body: JSON.stringify(init) })).status, 403);
    const preflight = await fetch(`${base}/mcp`, { method: 'OPTIONS', headers: { Origin: allowedOrigin } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), allowedOrigin);
    assert.match(preflight.headers.get('access-control-allow-headers'), /MCP-Protocol-Version/i);

    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } });
    const client = new Client({ name: 'fixture', version: '1' });
    t.after(async () => { try { await client.close(); } catch {} });
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some((tool) => tool.name === 'search_3gpp_docs'));
    const result = await client.callTool({ name: 'search_3gpp_docs', arguments: { query: 'attach reject', mode: 'auto' } });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.mode_requested, 'auto');
    assert.equal(payload.mode_actual, 'keyword');
    assert.ok(payload.warnings.includes('semantic_disabled_by_server'));
    assert.equal(payload.results[0].section_id, 'ts_24_301:1');
    const section = await client.callTool({ name: 'get_section', arguments: { sectionId: 'ts_24_301:1' } });
    assert.equal(JSON.parse(section.content[0].text).section.content, 'Fixture attach reject information.');

    const rejected = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(init) });
    assert.equal(rejected.status, 503, 'active sessions must be bounded');
    await transport.terminateSession();
    await client.close();
  });

  test('idle sessions expire and can be reinitialized', async (t) => {
    const { child, base } = await startServer();
    t.after(() => stopServer(child));
    const first = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(init) });
    const sessionId = first.headers.get('mcp-session-id');
    assert.ok(sessionId);
    await first.text();
    await delay(3000);
    const old = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...headers, 'Mcp-Session-Id': sessionId }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
    assert.equal(old.status, 404);
    const next = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(init) });
    assert.equal(next.status, 200);
    await next.text();
  });

  test('an active event stream is not expired as an idle session', async (t) => {
    const { child, base } = await startServer();
    t.after(() => stopServer(child));
    const first = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(init) });
    const sessionId = first.headers.get('mcp-session-id');
    assert.ok(sessionId);
    await first.text();
    const sessionHeaders = { ...headers, 'Mcp-Session-Id': sessionId, 'MCP-Protocol-Version': '2025-11-25' };
    await fetch(`${base}/mcp`, { method: 'POST', headers: sessionHeaders, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    const controller = new AbortController();
    try {
      const stream = await fetch(`${base}/mcp`, { headers: sessionHeaders, signal: controller.signal });
      assert.equal(stream.status, 200);
      await delay(3000);
      const request = await fetch(`${base}/mcp`, { method: 'POST', headers: sessionHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
      assert.equal(request.status, 200);
      await request.text();
    } finally {
      controller.abort();
    }
  });

  test('missing corpus is not reported ready', async (t) => {
    const { child, base } = await startServer({ THREEGPP_DB_PATH: path.join(dir, 'missing.db') });
    t.after(() => stopServer(child));
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/ready`)).status, 503);
    assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(init) })).status, 503);
  });

  test('invalid credentials also count against the rate limit', async (t) => {
    const { child, base } = await startServer({ RATE_LIMIT_MAX: '2' });
    t.after(() => stopServer(child));
    for (let i = 0; i < 2; i++) {
      const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...headers, Authorization: 'Bearer wrong' }, body: JSON.stringify(init) });
      assert.equal(response.status, 401);
    }
    const limited = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...headers, Authorization: 'Bearer wrong' }, body: JSON.stringify(init) });
    assert.equal(limited.status, 429);
  });
});
