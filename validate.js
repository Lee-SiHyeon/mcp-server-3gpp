#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { initDatabase } from "./src/db/schema.js";
import { closeConnection, getConnection } from "./src/db/connection.js";
import { createServer } from "./src/index.js";
import { getToolList, tools as toolRegistry } from "./src/tools/registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pkg = require(path.join(__dirname, "package.json"));

const EXPECTED_TOOLS = [
  "get_spec_catalog",
  "get_spec_toc",
  "get_section",
  "search_3gpp_docs",
  "search_related_sections",
  "list_specs",
  "get_ingest_guide",
  "get_spec_references",
];

const DB_CANDIDATES = [
  process.env.THREEGPP_DB_PATH,
  path.join(__dirname, "data", "corpus", "3gpp.db"),
  path.join(__dirname, "data", "3gpp.db"),
].filter(Boolean);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function resolveDbPath() {
  for (const candidate of DB_CANDIDATES) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      const db = initDatabase(candidate);
      db.db.close();
      return candidate;
    } catch {
      // Keep trying candidates.
    }
  }
  return null;
}

function parseToolPayload(response) {
  const text = response?.content?.[0]?.text;
  assert(text, "Tool response did not contain text content");
  return JSON.parse(text);
}

function logSection(title) {
  console.log(`\n=== ${title} ===`);
}

function preferSpec(db) {
  const preferred = ["ts_24_301", "ts_24_501", "ts_29_500", "rfc_3261"];
  for (const specId of preferred) {
    const row = db
      .prepare("SELECT id, title, total_sections FROM specs WHERE id = ?")
      .get(specId);
    if (row) return row;
  }

  return db
    .prepare("SELECT id, title, total_sections FROM specs ORDER BY id LIMIT 1")
    .get();
}

function pickSampleSection(db, specId) {
  return db.prepare(`
    SELECT id, spec_id, section_number, section_title, content_length
    FROM sections
    WHERE spec_id = ?
      AND section_number GLOB '[0-9]*'
      AND section_title IS NOT NULL
      AND length(trim(section_title)) > 0
    ORDER BY content_length DESC, section_number
    LIMIT 1
  `).get(specId);
}

function buildSearchQuery(sectionTitle) {
  const terms = String(sectionTitle || "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 3)
    .slice(0, 4);

  return terms.length > 0 ? terms.join(" ") : "registration procedure";
}

try {
  console.log("=== 3GPP MCP Server Validation (v2) ===");

  logSection("Package");
  console.log(`Name: ${pkg.name}`);
  console.log(`Version: ${pkg.version}`);
  console.log(`Main: ${pkg.main}`);

  const dbPath = resolveDbPath();
  assert(dbPath, `No usable database found. Checked: ${DB_CANDIDATES.join(", ")}`);

  logSection("Database");
  const { db: initDb, features } = initDatabase(dbPath);
  const tableCounts = {
    specs: initDb.prepare("SELECT COUNT(*) AS c FROM specs").get().c,
    toc: initDb.prepare("SELECT COUNT(*) AS c FROM toc").get().c,
    sections: initDb.prepare("SELECT COUNT(*) AS c FROM sections").get().c,
    spec_references: initDb.prepare("SELECT COUNT(*) AS c FROM spec_references").get().c,
    ingestion_runs: initDb.prepare("SELECT COUNT(*) AS c FROM ingestion_runs").get().c,
  };
  const hasVecTable = !!initDb
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vec_sections'")
    .get();
  const vecCount = hasVecTable
    ? initDb.prepare("SELECT COUNT(*) AS c FROM vec_sections").get().c
    : 0;

  console.log(`Resolved DB: ${dbPath}`);
  console.log(`FTS available: ${features.ftsSearch}`);
  console.log(`Vector extension loaded: ${features.vectorSearch}`);
  console.log(`vec_sections rows: ${vecCount}`);
  console.log(`Specs: ${tableCounts.specs}`);
  console.log(`TOC rows: ${tableCounts.toc}`);
  console.log(`Sections: ${tableCounts.sections}`);
  console.log(`Cross-spec references: ${tableCounts.spec_references}`);
  console.log(`Ingestion runs: ${tableCounts.ingestion_runs}`);

  assert(tableCounts.specs > 0, "Expected at least one spec in the corpus");
  assert(tableCounts.sections > 0, "Expected at least one section in the corpus");
  assert(tableCounts.toc > 0, "Expected at least one TOC row in the corpus");

  initDb.close();

  const db = getConnection(dbPath);
  const sampleSpec = preferSpec(db);
  assert(sampleSpec, "Could not find a sample spec");

  const sampleToc = db.prepare(`
    SELECT section_number, section_title, page, depth
    FROM toc
    WHERE spec_id = ?
    ORDER BY sort_order, section_number
    LIMIT 1
  `).get(sampleSpec.id);

  const sampleSection = pickSampleSection(db, sampleSpec.id);
  assert(sampleSection, `Could not find a sample section for ${sampleSpec.id}`);

  const referenceSpec = db.prepare(`
    SELECT source_spec_id AS spec_id, COUNT(*) AS c
    FROM spec_references
    GROUP BY source_spec_id
    ORDER BY c DESC, source_spec_id
    LIMIT 1
  `).get();

  console.log(`Sample spec: ${sampleSpec.id} (${sampleSpec.total_sections} sections)`);
  if (sampleToc) {
    console.log(`Sample TOC entry: ${sampleSpec.id}:${sampleToc.section_number} - ${sampleToc.section_title}`);
  }
  console.log(`Sample section: ${sampleSection.id} - ${sampleSection.section_title}`);
  if (referenceSpec) {
    console.log(`Reference-heavy spec: ${referenceSpec.spec_id} (${referenceSpec.c} citations)`);
  }

  logSection("Tool registration");
  createServer();
  const registeredTools = getToolList().map((tool) => tool.name);
  const missingTools = EXPECTED_TOOLS.filter((tool) => !registeredTools.includes(tool));
  const extraTools = registeredTools.filter((tool) => !EXPECTED_TOOLS.includes(tool));

  assert(missingTools.length === 0, `Missing tools: ${missingTools.join(", ")}`);
  assert(extraTools.length === 0, `Unexpected tools: ${extraTools.join(", ")}`);

  console.log(`Registered tools: ${registeredTools.join(", ")}`);

  logSection("Navigation smoke test");
  const searchQuery = buildSearchQuery(sampleSection.section_title);

  const catalogPayload = parseToolPayload(
    toolRegistry.get("get_spec_catalog").handler({ filter: sampleSpec.id })
  );
  assert(Array.isArray(catalogPayload.specs), "get_spec_catalog did not return a specs array");
  assert(catalogPayload.specs.length > 0, "get_spec_catalog returned no specs");

  const tocPayload = parseToolPayload(
    toolRegistry.get("get_spec_toc").handler({ specId: sampleSpec.id, maxDepth: 2 })
  );
  assert(Array.isArray(tocPayload.entries), "get_spec_toc did not return entries");
  assert(tocPayload.entries.length > 0, `get_spec_toc returned no entries for ${sampleSpec.id}`);

  const sectionPayload = parseToolPayload(
    toolRegistry.get("get_section").handler({ sectionId: sampleSection.id, maxChars: 400 })
  );
  assert(sectionPayload.section?.section_id === sampleSection.id, "get_section returned the wrong section");

  const relatedPayload = parseToolPayload(
    toolRegistry.get("search_related_sections").handler({ sectionId: sampleSection.id, maxResults: 3 })
  );
  assert(Array.isArray(relatedPayload.results), "search_related_sections did not return results");

  const searchPayload = parseToolPayload(
    toolRegistry.get("search_3gpp_docs").handler({
      query: searchQuery,
      spec: sampleSpec.id,
      maxResults: 3,
      includeScores: true,
    })
  );
  assert(Array.isArray(searchPayload.results), "search_3gpp_docs did not return results");

  const refsPayload = referenceSpec
    ? parseToolPayload(
        toolRegistry.get("get_spec_references").handler({
          specId: referenceSpec.spec_id,
          direction: "outgoing",
          maxResults: 3,
        })
      )
    : null;
  if (refsPayload) {
    assert(refsPayload.spec_id === referenceSpec.spec_id, "get_spec_references returned the wrong spec");
  }

  const listPayload = parseToolPayload(toolRegistry.get("list_specs").handler({}));
  assert(Array.isArray(listPayload.specs), "list_specs did not return specs");
  assert(listPayload.specs.length > 0, "list_specs returned no specs");

  const guidePayload = parseToolPayload(
    toolRegistry.get("get_ingest_guide").handler({ type: "all" })
  );
  assert(guidePayload.guides?.etsi, "get_ingest_guide missing ETSI guide");
  assert(guidePayload.guides?.rfc, "get_ingest_guide missing RFC guide");
  assert(guidePayload.guides?.autorag, "get_ingest_guide missing AutoRAG guide");

  console.log(`Catalog sample count: ${catalogPayload.specs.length}`);
  console.log(`TOC entries returned: ${tocPayload.entries.length}`);
  console.log(`Section retrieved: ${sectionPayload.section.section_id}`);
  console.log(`Related sections returned: ${relatedPayload.results.length}`);
  console.log(`Search query used: "${searchQuery}"`);
  console.log(`Search mode actual: ${searchPayload.mode_actual}`);
  console.log(`Search results returned: ${searchPayload.results.length}`);
  if (searchPayload.warnings?.length) {
    console.log(`Search warnings: ${searchPayload.warnings.join("; ")}`);
  }
  if (refsPayload?.outgoing) {
    console.log(`Outgoing references returned: ${refsPayload.outgoing.count}`);
  }

  logSection("Interpretation");
  console.log("Validation confirms the v2 DB-backed server, the current 8-tool surface, and the intended chapter-navigation workflow.");
  console.log("Search is validated as a discovery tool. Exact retrieval still flows through get_spec_toc and get_section.");

  closeConnection();
  console.log("\nValidation passed.");
} catch (error) {
  closeConnection();
  console.error(`\nValidation failed: ${error.message}`);
  process.exit(1);
}
