#!/usr/bin/env node

/**
 * 3GPP MCP Server — HTTP Transport (Streamable HTTP)
 *
 * Production-ready HTTP server for remote MCP access.
 * Uses StreamableHTTPServerTransport from the MCP SDK with:
 *   - API key authentication
 *   - Rate limiting
 *   - CORS support
 *   - Health check endpoint
 *   - Graceful shutdown
 *
 * Usage:
 *   node src/http.js
 *   API_KEY=secret PORT=3000 node src/http.js
 */

import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, resolveDbPath } from "./index.js";
import { shutdown } from "./index.js";
import Database from "better-sqlite3";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import http from "node:http";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const API_KEY = process.env.API_KEY || "";
// Requests without Origin are accepted (typical non-browser MCP clients).
// Browser origins must be explicitly configured; a wildcard is not validation.
const ALLOWED_ORIGINS = new Set((process.env.CORS_ORIGIN || "")
  .split(",").map((origin) => origin.trim()).filter(Boolean));
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "100", 10);
const MAX_BODY_BYTES = parseInt(process.env.MAX_BODY_BYTES || "1048576", 10);
const TRUST_PROXY = process.env.TRUST_PROXY === "true";
const ALLOW_OPEN_HTTP = process.env.ALLOW_OPEN_HTTP === "true";
const REQUIRE_API_KEY = process.env.NODE_ENV === "production" && !ALLOW_OPEN_HTTP;
const MAX_SESSIONS = Math.max(1, parseInt(process.env.MAX_SESSIONS || "64", 10));
const SESSION_TTL_MS = Math.max(1000, parseInt(process.env.SESSION_TTL_MS || "1800000", 10));

// ---------------------------------------------------------------------------
// Rate limiter (in-memory, per-IP)
// ---------------------------------------------------------------------------
const rateLimiter = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimiter.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimiter.set(ip, { windowStart: now, count: 1 });
    return true;
  }

  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

// Clean up stale entries every 5 minutes
const rateLimitCleanup = setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS * 2;
  for (const [ip, entry] of rateLimiter) {
    if (entry.windowStart < cutoff) rateLimiter.delete(ip);
  }
}, 300_000);
rateLimitCleanup.unref();

// ---------------------------------------------------------------------------
// CORS headers helper
// ---------------------------------------------------------------------------
function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

// ---------------------------------------------------------------------------
// API key authentication
// ---------------------------------------------------------------------------
function authenticate(req) {
  if (!API_KEY) return !REQUIRE_API_KEY;

  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Bearer ")) {
    const actual = Buffer.from(authHeader.slice(7));
    const expected = Buffer.from(API_KEY);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  // Query parameter auth removed — use Authorization header only
  return false;
}

function getSingleHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

function getClientIp(req) {
  if (TRUST_PROXY) {
    const forwardedFor = getSingleHeader(req.headers["x-forwarded-for"]);
    const forwardedIp = forwardedFor?.split(",")[0]?.trim();
    if (forwardedIp) return forwardedIp;
  }

  return req.socket.remoteAddress || "unknown";
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// ---------------------------------------------------------------------------
// Parse JSON body from incoming request
// ---------------------------------------------------------------------------
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let failed = false;

    function fail(statusCode, message) {
      if (failed) return;
      failed = true;
      reject(httpError(statusCode, message));
    }

    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        fail(413, `Request body exceeds ${MAX_BODY_BYTES} bytes`);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (failed) return;
      const body = Buffer.concat(chunks).toString("utf-8");
      if (!body) return resolve(undefined);
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(httpError(400, `Invalid JSON body: ${err.message}`));
      }
    });
    req.on("error", (err) => {
      if (!failed) reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Session tracking for multi-transport management
// ---------------------------------------------------------------------------
const sessions = new Map();
let pendingSessions = 0;

function inspectCorpus() {
  const path = resolveDbPath();
  if (!path) return { ready: false, reason: "corpus_missing" };
  let db;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const specs = db.prepare("SELECT 1 FROM specs LIMIT 1").get();
    const sections = db.prepare("SELECT 1 FROM sections LIMIT 1").get();
    const fts = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sections_fts'").get();
    return specs && sections && fts
      ? { ready: true }
      : { ready: false, reason: "corpus_incomplete" };
  } catch {
    return { ready: false, reason: "corpus_unreadable" };
  } finally {
    db?.close();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (ALLOWED_ORIGINS.has("*")) {
    throw new Error("CORS_ORIGIN must list explicit origins; wildcard is not supported.");
  }
  if (REQUIRE_API_KEY && !API_KEY) {
    throw new Error("API_KEY is required in production. Set ALLOW_OPEN_HTTP=true to run without authentication.");
  }

  const sessionCleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (session.activeResponses || now - session.lastUsedAt < SESSION_TTL_MS) continue;
      sessions.delete(id);
      Promise.resolve(session.server.close()).catch((error) => {
        console.error("[3GPP MCP HTTP] Session cleanup failed:", error.message);
      });
    }
  }, Math.min(30_000, Math.max(1000, SESSION_TTL_MS / 2)));
  sessionCleanup.unref();

  const httpServer = http.createServer(async (req, res) => {
    if (req.headers.origin && !ALLOWED_ORIGINS.has(req.headers.origin)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Origin not allowed" }));
      return;
    }
    setCorsHeaders(req, res);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, "http://localhost");

    // Health check endpoint
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        service: "mcp-server-3gpp",
        transport: "streamable-http",
        sessions: sessions.size,
      }));
      return;
    }

    // Readiness checks the corpus rather than only the HTTP process. Do not
    // expose a host path or the underlying database error over the network.
    if (url.pathname === "/ready") {
      const state = inspectCorpus();
      res.writeHead(state.ready ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state));
      return;
    }

    // Only handle /mcp endpoint for MCP protocol
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found. Use /mcp endpoint." }));
      return;
    }

    // Count unauthenticated requests as well, so invalid-key traffic cannot
    // bypass the limit. When using a proxy, enable TRUST_PROXY only if it
    // strips untrusted forwarded headers.
    const clientIp = getClientIp(req);
    if (!checkRateLimit(clientIp)) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Rate limit exceeded" }));
      return;
    }

    // Authentication
    if (!authenticate(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized. Provide API key via Authorization: Bearer <key>" }));
      return;
    }

    try {
      // For POST requests, parse the body first
      let parsedBody;
      if (req.method === "POST") {
        parsedBody = await parseBody(req);
      }

      // Determine session handling
      const sessionId = getSingleHeader(req.headers["mcp-session-id"]);

      let transport;
      let session;
      if (sessionId && sessions.has(sessionId)) {
        // Reuse existing transport for the session
        session = sessions.get(sessionId);
        session.lastUsedAt = Date.now();
        transport = session.transport;
      } else if (req.method === "POST" && parsedBody && isInitializeRequest(parsedBody)) {
        if (!inspectCorpus().ready) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Corpus not ready" }));
          return;
        }
        if (sessions.size + pendingSessions >= MAX_SESSIONS) {
          res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "60" });
          res.end(JSON.stringify({ error: "Session limit reached" }));
          return;
        }
        pendingSessions++;
        // New initialization request — create a new transport
        try {
          const mcpServer = createServer();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              sessions.set(sid, { transport, server: mcpServer, lastUsedAt: Date.now(), activeResponses: 0 });
            },
            onsessionclosed: (sid) => {
              const server = sessions.get(sid)?.server;
              sessions.delete(sid);
              if (server) Promise.resolve(server.close()).catch((error) => {
                console.error("[3GPP MCP HTTP] Session close failed:", error.message);
              });
            },
          });
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, parsedBody);
        } finally {
          pendingSessions--;
        }
        return;
      } else if (!sessionId) {
        // Stateful mode requires session ID after initialization
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing Mcp-Session-Id header. Initialize first." }));
        return;
      } else {
        // Unknown session ID
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return;
      }

      // An active event stream is not an idle session. Track it until its
      // response finishes or disconnects so the cleanup timer cannot evict it.
      if (session) {
        session.activeResponses++;
        let finished = false;
        const releaseResponse = () => {
          if (finished) return;
          finished = true;
          session.activeResponses--;
          session.lastUsedAt = Date.now();
        };
        res.once("finish", releaseResponse);
        res.once("close", releaseResponse);
      }
      // Let the transport handle the request
      await transport.handleRequest(req, res, parsedBody);
    } catch (err) {
      console.error("[3GPP MCP HTTP] Request error:", err);
      if (!res.headersSent) {
        const statusCode = err.statusCode || 500;
        const message = statusCode >= 500 ? "Internal server error" : err.message;
        res.writeHead(statusCode, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
    }
  });

  // Graceful shutdown
  const handleShutdown = () => {
    console.error("[3GPP MCP HTTP] Shutting down…");
    clearInterval(rateLimitCleanup);
    clearInterval(sessionCleanup);
    for (const { transport, server } of sessions.values()) {
      transport.close?.();
      server.close();
    }
    sessions.clear();
    httpServer.close(() => {
      shutdown();
    });
  };
  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  httpServer.listen(PORT, HOST, () => {
    console.error(`[3GPP MCP HTTP] Server listening on port ${PORT}`);
    console.error(`[3GPP MCP HTTP] MCP endpoint: http://localhost:${PORT}/mcp`);
    console.error(`[3GPP MCP HTTP] Health check: http://localhost:${PORT}/health`);
    console.error(`[3GPP MCP HTTP] Auth: ${API_KEY ? "API key required" : "open (no API_KEY set)"}`);
    console.error(`[3GPP MCP HTTP] Max body bytes: ${MAX_BODY_BYTES}`);
    console.error(`[3GPP MCP HTTP] Trust proxy: ${TRUST_PROXY}`);
  });
}

main().catch((err) => {
  console.error("[3GPP MCP HTTP] Fatal:", err);
  process.exit(1);
});
