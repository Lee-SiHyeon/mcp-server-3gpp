#!/usr/bin/env node

/**
 * 3GPP Document Search MCP Server (v2)
 *
 * SQLite-backed MCP server with hybrid search, structured TOC navigation,
 * and section retrieval. Falls back to legacy chunks.json mode when the
 * corpus database is not available.
 *
 * Tools (v2):
 *   get_spec_catalog, get_spec_toc, get_section,
 *   search_3gpp_docs, search_related_sections,
 *   get_emm_cause, list_specs
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const require = createRequire(import.meta.url);
const { version } = require(path.join(PROJECT_ROOT, "package.json"));

// Possible DB locations (checked in order)
const DB_CANDIDATES = [
  process.env.THREEGPP_DB_PATH,
  path.join(PROJECT_ROOT, "data", "corpus", "3gpp.db"),
  path.join(PROJECT_ROOT, "data", "3gpp.db"),
].filter(Boolean);

// ---------------------------------------------------------------------------
// Tool imports (v2 – DB-backed)
// ---------------------------------------------------------------------------
import { tools as toolRegistry, registerTool, getToolList } from "./tools/registry.js";

import { getSpecCatalogSchema, handleGetSpecCatalog } from "./tools/getSpecCatalog.js";
import { getSpecTocSchema, handleGetSpecToc } from "./tools/getSpecToc.js";
import { getSectionSchema, handleGetSection } from "./tools/getSection.js";
import { search3gppDocsSchema, handleSearch3gppDocs } from "./tools/search3gppDocs.js";
import { searchRelatedSectionsSchema, handleSearchRelatedSections } from "./tools/searchRelatedSections.js";
import { getEmmCauseSchema, handleGetEmmCause } from "./tools/getEmmCause.js";
import { listSpecsSchema, handleListSpecs } from "./tools/listSpecs.js";

// DB modules
import { getConnection, closeConnection } from "./db/connection.js";
import { initDatabase } from "./db/schema.js";

// ---------------------------------------------------------------------------
// Resolve the database path (first candidate that exists on disk)
// ---------------------------------------------------------------------------
function resolveDbPath() {
  for (const candidate of DB_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Register all v2 tools into the shared registry
// ---------------------------------------------------------------------------
function registerAllTools() {
  registerTool(getSpecCatalogSchema.name, getSpecCatalogSchema, handleGetSpecCatalog);
  registerTool(getSpecTocSchema.name, getSpecTocSchema, handleGetSpecToc);
  registerTool(getSectionSchema.name, getSectionSchema, handleGetSection);
  registerTool(search3gppDocsSchema.name, search3gppDocsSchema, handleSearch3gppDocs);
  registerTool(searchRelatedSectionsSchema.name, searchRelatedSectionsSchema, handleSearchRelatedSections);
  registerTool(getEmmCauseSchema.name, getEmmCauseSchema, handleGetEmmCause);
  registerTool(listSpecsSchema.name, listSpecsSchema, handleListSpecs);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const dbPath = resolveDbPath();
  let dbFeatures = null;

  if (dbPath) {
    // Initialise schema (idempotent) and probe optional extensions
    try {
      const { db, features } = initDatabase(dbPath);
      dbFeatures = features;
      db.close(); // close the init handle; tools use the singleton below
    } catch (err) {
      console.error(`[3GPP MCP] Schema init warning: ${err.message}`);
    }

    // Warm up the singleton connection that tool handlers rely on
    getConnection(dbPath);
    console.error(`[3GPP MCP] Database ready: ${dbPath}`);
    if (dbFeatures) {
      console.error(`[3GPP MCP] Features — FTS: ${dbFeatures.ftsSearch}, Vector: ${dbFeatures.vectorSearch}`);
    }

    registerAllTools();
    console.error(`[3GPP MCP] Registered ${toolRegistry.size} tools (v2 DB mode)`);
  } else {
    // -----------------------------------------------------------------------
    // Legacy fallback: no SQLite DB found — run v1 chunks.json mode
    // -----------------------------------------------------------------------
    console.error("[3GPP MCP] No SQLite database found, falling back to legacy chunks.json mode");

    const CHUNKS_FILE = process.env.CHUNKS_FILE_PATH ||
      path.join(PROJECT_ROOT, "data", "chunks.json");

    let chunksData = [];
    try {
      const raw = fs.readFileSync(CHUNKS_FILE, "utf-8");
      chunksData = JSON.parse(raw);
      console.error(`[3GPP MCP] Loaded ${chunksData.length} chunks from ${CHUNKS_FILE}`);
    } catch (err) {
      console.error(`[3GPP MCP] Error loading chunks: ${err.message}`);
    }

    // Minimal keyword search over chunks
    function searchChunks(query, specFilter = null, maxResults = 5) {
      const keywords = query.toLowerCase().split(/\s+/);
      return chunksData
        .filter(chunk => {
          if (specFilter) {
            const spec = chunk.spec?.toLowerCase() || "";
            if (!spec.includes(specFilter.toLowerCase().replace(/\s+/g, "").replace("ts", ""))) return false;
          }
          const text = chunk.text?.toLowerCase() || "";
          return keywords.every(kw => text.includes(kw));
        })
        .map(chunk => {
          const text = chunk.text?.toLowerCase() || "";
          const score = keywords.reduce((s, kw) => s + (text.match(new RegExp(kw, "g")) || []).length, 0);
          return { ...chunk, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
    }

    // Register legacy tools in the registry so the same handler map works
    registerTool("search_3gpp_docs", {
      name: "search_3gpp_docs",
      description: "Search 3GPP specification documents by keywords (legacy mode)",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          spec: { type: "string", description: "Filter by specification" },
          maxResults: { type: "number", description: "Max results (default: 5)" },
        },
        required: ["query"],
      },
    }, (args) => {
      const results = searchChunks(args.query, args.spec || null, args.maxResults || 5);
      if (results.length === 0) {
        return { content: [{ type: "text", text: `No results found for "${args.query}"` }] };
      }
      const text = results.map((r, i) => {
        const src = r.spec || "Unknown";
        const preview = r.text.substring(0, 500) + (r.text.length > 500 ? "..." : "");
        return `[${i + 1}] Source: ${src}\n${preview}`;
      }).join("\n\n---\n\n");
      return { content: [{ type: "text", text }] };
    });

    registerTool("list_specs", {
      name: "list_specs",
      description: "List available 3GPP specifications (legacy mode)",
      inputSchema: { type: "object", properties: {} },
    }, () => {
      const sources = [...new Set(chunksData.map(c => c.spec || "Unknown"))];
      return { content: [{ type: "text", text: JSON.stringify({ specs: sources, totalChunks: chunksData.length }, null, 2) }] };
    });

    console.error(`[3GPP MCP] Registered ${toolRegistry.size} tools (legacy mode)`);
  }

  // -------------------------------------------------------------------------
  // Create and configure the low-level MCP Server
  // -------------------------------------------------------------------------
  const server = new Server(
    { name: "3gpp-doc-server", version },
    { capabilities: { tools: {} } },
  );

  // -- tools/list -----------------------------------------------------------
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolList(),
  }));

  // -- tools/call -----------------------------------------------------------
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const entry = toolRegistry.get(name);

    if (!entry) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
    }

    try {
      return entry.handler(args ?? {});
    } catch (err) {
      console.error(`[3GPP MCP] Tool "${name}" error:`, err);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  });

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------
  const shutdown = () => {
    console.error("[3GPP MCP] Shutting down…");
    closeConnection();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // -------------------------------------------------------------------------
  // Connect transport
  // -------------------------------------------------------------------------
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[3GPP MCP] Server started (v2)");
}

main().catch((err) => {
  console.error("[3GPP MCP] Fatal:", err);
  closeConnection();
  process.exit(1);
});
