/**
 * AnyTXT Searcher JSON-RPC client.
 *
 * Communicates with AnyTXT's local HTTP server (default localhost:9920)
 * via JSON-RPC 2.0. Provides document search, fragment extraction,
 * folder indexing, and health detection.
 *
 * AnyTXT is an optional Windows-only component. All methods fail
 * gracefully when the service is unavailable.
 */

const DEFAULT_PORT = 9920;
const DEFAULT_HOST = '127.0.0.1';
const RPC_ID = 1;

let availabilityCache = { available: false, checkedAt: 0 };
const AVAILABILITY_TTL_MS = 60_000;

function buildPayload(method, params) {
  return {
    id: RPC_ID,
    jsonrpc: '2.0',
    method,
    params: { input: params },
  };
}

async function rpcRequest(host, port, payload, timeoutMs = 5000) {
  const url = `http://${host}:${port}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const json = await response.json();

    if (json.error) {
      return { ok: false, error: json.error.message || JSON.stringify(json.error) };
    }

    return { ok: true, data: json.result?.data?.output ?? json.result };
  } catch (e) {
    if (e.name === 'AbortError') {
      return { ok: false, error: 'timeout' };
    }
    if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND') {
      return { ok: false, error: 'connection_refused' };
    }
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAvailability(host = DEFAULT_HOST, port = DEFAULT_PORT) {
  const now = Date.now();
  if (now - availabilityCache.checkedAt < AVAILABILITY_TTL_MS) {
    return availabilityCache.available;
  }

  const result = await rpcRequest(host, port, buildPayload('ATRpcServer.Searcher.V1.GetResult', {
    pattern: '__health_check__',
    limit: 0,
    offset: 0,
  }), 2000);

  const available = result.ok;
  availabilityCache = { available, checkedAt: now };
  return available;
}

export function invalidateAvailabilityCache() {
  availabilityCache = { available: false, checkedAt: 0 };
}

export function getAvailabilityStatus() {
  return { ...availabilityCache };
}

export async function searchFiles(pattern, options = {}) {
  const {
    filterDir = '',
    filterExt = '',
    limit = 100,
    offset = 0,
    order = 0,
    lastModifyBegin = 0,
    lastModifyEnd = 2147483647,
    host = DEFAULT_HOST,
    port = DEFAULT_PORT,
  } = options;

  const params = {
    pattern,
    filterDir,
    filterExt,
    lastModifyBegin,
    lastModifyEnd,
    limit,
    offset,
    order,
  };

  const result = await rpcRequest(host, port, buildPayload('ATRpcServer.Searcher.V1.GetResult', params));

  if (!result.ok) {
    return { ok: false, files: [], error: result.error };
  }

  const output = result.data;
  if (!output || typeof output !== 'object') {
    return { ok: true, files: [], count: 0 };
  }

  const files = (output.files || []).map(file => ({
    id: file[0],
    path: file[1],
    title: file[2],
    ext: file[3],
    size: file[4],
    lastModified: file[5],
    snippet: file[6] || '',
  }));

  return { ok: true, files, count: output.count ?? files.length };
}

export async function getFragment(fileId, pattern, options = {}) {
  const {
    host = DEFAULT_HOST,
    port = DEFAULT_PORT,
  } = options;

  const result = await rpcRequest(
    host,
    port,
    buildPayload('ATRpcServer.Searcher.V1.GetFragment', { fid: fileId, pattern }),
  );

  if (!result.ok) {
    return { ok: false, text: '', error: result.error };
  }

  const output = result.data;
  if (typeof output === 'object' && output.text) {
    return { ok: true, text: output.text };
  }

  return { ok: true, text: String(output || '') };
}

export async function getFragmentAll(fileId, pattern, options = {}) {
  const {
    host = DEFAULT_HOST,
    port = DEFAULT_PORT,
  } = options;

  const result = await rpcRequest(
    host,
    port,
    buildPayload('ATRpcServer.Searcher.V1.GetFragmentAll', { fid: fileId, pattern }),
  );

  if (!result.ok) {
    return { ok: false, fragments: [], error: result.error };
  }

  return { ok: true, fragments: Array.isArray(result.data) ? result.data : [result.data] };
}

export async function syncIndex(dirPath, options = {}) {
  const {
    host = DEFAULT_HOST,
    port = DEFAULT_PORT,
  } = options;

  const result = await rpcRequest(
    host,
    port,
    buildPayload('ATRpcServer.Searcher.V1.SyncIndex', { dir: dirPath }),
  );

  return result.ok;
}

export async function extractText(filePath, host = DEFAULT_HOST, port = DEFAULT_PORT) {
  const dir = filePath.replace(/[/\\][^/\\]+$/, '');
  const fileName = filePath.replace(/.*[/\\]/, '');

  const searchResult = await searchFiles(fileName, {
    filterDir: dir,
    limit: 1,
    host,
    port,
  });

  if (!searchResult.ok || searchResult.files.length === 0) {
    return { ok: false, text: '', error: 'file_not_found_in_index' };
  }

  const fileId = searchResult.files[0].id;
  const fragmentResult = await getFragmentAll(fileId, '', { host, port });

  if (!fragmentResult.ok) {
    return { ok: false, text: '', error: fragmentResult.error };
  }

  const fullText = fragmentResult.fragments
    .map(f => typeof f === 'string' ? f : f.text || '')
    .join('\n');

  return { ok: true, text: fullText };
}
