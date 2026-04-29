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
  "search_etsi_catalog",
  "get_etsi_document",
];

const DB_CANDIDATES = [
  process.env.THREEGPP_DB_PATH,
  path.join(__dirname, "data", "corpus", "3gpp.db"),
  path.join(__dirname, "data", "3gpp.db"),
].filter(Boolean);

const SEMANTIC_ACTIVE_MODES = new Set(["semantic", "hybrid"]);
const TRANSFORMERS_PACKAGES = ["@huggingface/transformers", "@xenova/transformers"];

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

async function resolveToolPayload(responseOrPromise) {
  return parseToolPayload(await Promise.resolve(responseOrPromise));
}

async function invokeTool(name, args) {
  const tool = toolRegistry.get(name);
  assert(tool, `Tool is not registered: ${name}`);
  return resolveToolPayload(tool.handler(args));
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

function getInstalledTransformersPackage() {
  for (const packageName of TRANSFORMERS_PACKAGES) {
    try {
      require.resolve(packageName);
      return packageName;
    } catch {
      // Try the next compatible package.
    }
  }
  return null;
}

export function evaluateSemanticReadiness({
  vectorExtensionLoaded,
  vecCount,
  transformersPackage,
  searchPayload,
}) {
  const reasons = [];
  const warnings = Array.isArray(searchPayload?.warnings) ? searchPayload.warnings : [];
  const semanticEvidence = Array.isArray(searchPayload?.results)
    ? searchPayload.results.some((result) => Array.isArray(result.evidence) && result.evidence.includes("semantic"))
    : false;
  const modeActual = searchPayload?.mode_actual ?? "keyword";
  const modeRequested = searchPayload?.mode_requested ?? "auto";

  if (!vectorExtensionLoaded) {
    reasons.push("sqlite-vec extension is not loaded");
  }
  if (vecCount === 0) {
    reasons.push("vec_sections has no embeddings");
  }
  if (!transformersPackage) {
    reasons.push("no compatible transformers package is installed");
  }
  if (!SEMANTIC_ACTIVE_MODES.has(modeActual)) {
    reasons.push(`search_3gpp_docs stayed in ${modeActual} mode`);
  }
  if (!semanticEvidence) {
    reasons.push("search results did not include semantic evidence");
  }

  return {
    optional: true,
    prerequisites_met: vectorExtensionLoaded && vecCount > 0 && Boolean(transformersPackage),
    semantic_active: SEMANTIC_ACTIVE_MODES.has(modeActual) && semanticEvidence,
    transformers_package: transformersPackage,
    mode_requested: modeRequested,
    mode_actual: modeActual,
    reasons,
    warnings,
  };
}

export async function runValidation() {
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
    etsi_documents: initDb.prepare("SELECT COUNT(*) AS c FROM etsi_documents").get().c,
    etsi_versions: initDb.prepare("SELECT COUNT(*) AS c FROM etsi_versions").get().c,
    etsi_document_status: initDb.prepare("SELECT COUNT(*) AS c FROM etsi_document_status").get().c,
    catalog_crawl_progress: initDb.prepare("SELECT COUNT(*) AS c FROM catalog_crawl_progress").get().c,
  };
  const hasVecTable = !!initDb
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vec_sections'")
    .get();
  const vecCount = hasVecTable
    ? initDb.prepare("SELECT COUNT(*) AS c FROM vec_sections").get().c
    : 0;
  const transformersPackage = getInstalledTransformersPackage();

  console.log(`Resolved DB: ${dbPath}`);
  console.log(`FTS available: ${features.ftsSearch}`);
  console.log(`Vector extension loaded: ${features.vectorSearch}`);
  console.log(`vec_sections rows: ${vecCount}`);
  console.log(`Transformers package: ${transformersPackage ?? "not installed"}`);
  console.log(`Specs: ${tableCounts.specs}`);
  console.log(`TOC rows: ${tableCounts.toc}`);
  console.log(`Sections: ${tableCounts.sections}`);
  console.log(`Cross-spec references: ${tableCounts.spec_references}`);
  console.log(`Ingestion runs: ${tableCounts.ingestion_runs}`);
  console.log(`ETSI catalog documents: ${tableCounts.etsi_documents}`);
  console.log(`ETSI catalog versions: ${tableCounts.etsi_versions}`);
  console.log(`ETSI document status rows: ${tableCounts.etsi_document_status}`);
  console.log(`ETSI crawl progress rows: ${tableCounts.catalog_crawl_progress}`);

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

  const catalogPayload = await invokeTool("get_spec_catalog", { filter: sampleSpec.id });
  assert(Array.isArray(catalogPayload.specs), "get_spec_catalog did not return a specs array");
  assert(catalogPayload.specs.length > 0, "get_spec_catalog returned no specs");

  const tocPayload = await invokeTool("get_spec_toc", { specId: sampleSpec.id, maxDepth: 2 });
  assert(Array.isArray(tocPayload.entries), "get_spec_toc did not return entries");
  assert(tocPayload.entries.length > 0, `get_spec_toc returned no entries for ${sampleSpec.id}`);

  const sectionPayload = await invokeTool("get_section", { sectionId: sampleSection.id, maxChars: 400 });
  assert(sectionPayload.section?.section_id === sampleSection.id, "get_section returned the wrong section");

  const relatedPayload = await invokeTool("search_related_sections", { sectionId: sampleSection.id, maxResults: 3 });
  assert(Array.isArray(relatedPayload.results), "search_related_sections did not return results");

  const searchPayload = await invokeTool("search_3gpp_docs", {
    query: searchQuery,
    spec: sampleSpec.id,
    maxResults: 3,
    includeScores: true,
    mode: "auto",
  });
  assert(Array.isArray(searchPayload.results), "search_3gpp_docs did not return results");

  const refsPayload = referenceSpec
    ? await invokeTool("get_spec_references", {
        specId: referenceSpec.spec_id,
        direction: "outgoing",
        maxResults: 3,
      })
    : null;
  if (refsPayload) {
    assert(refsPayload.spec_id === referenceSpec.spec_id, "get_spec_references returned the wrong spec");
  }

  const etsiCatalogPayload = await invokeTool("search_etsi_catalog", { maxResults: 1 });
  assert(etsiCatalogPayload.status?.counts, "search_etsi_catalog missing catalog status");
  assert(Array.isArray(etsiCatalogPayload.documents), "search_etsi_catalog did not return documents");

  const etsiDocumentPayload = await invokeTool("get_etsi_document", { documentId: "does_not_exist" });
  assert(etsiDocumentPayload.error, "get_etsi_document should return a clean not-found error");

  const listPayload = await invokeTool("list_specs", {});
  assert(Array.isArray(listPayload.specs), "list_specs did not return specs");
  assert(listPayload.specs.length > 0, "list_specs returned no specs");

  const guidePayload = await invokeTool("get_ingest_guide", { type: "all" });
  assert(guidePayload.guides?.catalog, "get_ingest_guide missing catalog guide");
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
  console.log(`ETSI catalog rows returned: ${etsiCatalogPayload.documents.length}`);

  logSection("Readiness");
  const semanticReadiness = evaluateSemanticReadiness({
    vectorExtensionLoaded: features.vectorSearch,
    vecCount,
    transformersPackage,
    searchPayload,
  });
  console.log("Baseline keyword readiness: true");
  console.log(`Optional semantic prerequisites met: ${semanticReadiness.prerequisites_met}`);
  console.log(`Semantic-active tool smoke: ${semanticReadiness.semantic_active}`);
  console.log(`Semantic transformers runtime: ${semanticReadiness.transformers_package ?? "missing"}`);
  console.log(`Semantic smoke mode requested: ${semanticReadiness.mode_requested}`);
  console.log(`Semantic smoke mode actual: ${semanticReadiness.mode_actual}`);
  if (semanticReadiness.reasons.length > 0) {
    console.log(`Semantic readiness blockers: ${semanticReadiness.reasons.join("; ")}`);
  }

  logSection("Interpretation");
  console.log("Validation confirms the v2 DB-backed server, the current 10-tool surface, and the intended chapter-navigation workflow.");
  console.log("Baseline validation proves keyword-first discovery and the chapter-navigation workflow.");
  console.log("Semantic retrieval is optional and only counts as active when the smoke path actually returns semantic/hybrid evidence, not merely because vec_sections exists.");

  closeConnection();
  console.log("\nValidation passed.");
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  runValidation().catch((error) => {
    closeConnection();
    console.error(`\nValidation failed: ${error.message}`);
    process.exit(1);
  });
}
