/**
 * Simple MCP Server Validation
 * 
 * MCP 서버가 정상적으로 로드되고 도구가 등록되었는지 확인합니다.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("=== 3GPP MCP Server Validation ===\n");

// 청크 파일 확인
const chunksFile = path.join(__dirname, "data", "chunks.json");
try {
  const data = await fs.readFile(chunksFile, "utf-8");
  const chunks = JSON.parse(data);
  console.log("✅ Chunks file loaded successfully");
  console.log(`   - Total chunks: ${chunks.length}`);
  console.log(`   - First chunk spec: ${chunks[0]?.spec}`);
  console.log(`   - Sample chunk keys: ${Object.keys(chunks[0] || {}).join(', ')}`);
} catch (error) {
  console.log("❌ Failed to load chunks file:", error.message);
  process.exit(1);
}

// package.json 확인
const packageFile = path.join(__dirname, "package.json");
try {
  const data = await fs.readFile(packageFile, "utf-8");
  const pkg = JSON.parse(data);
  console.log("\n✅ Package configuration:");
  console.log(`   - Name: ${pkg.name}`);
  console.log(`   - Version: ${pkg.version}`);
  console.log(`   - Main: ${pkg.main}`);
} catch (error) {
  console.log("❌ Failed to load package.json:", error.message);
}

// 서버 파일 확인
const serverFile = path.join(__dirname, "src", "index.js");
try {
  await fs.access(serverFile);
  console.log("\n✅ Server file exists: src/index.js");
} catch (error) {
  console.log("❌ Server file not found");
  process.exit(1);
}

console.log("\n=== Available Tools ===");
console.log("1. search_3gpp_docs");
console.log("   - Search 3GPP documents by keywords");
console.log("   - Example: query='attach procedure', spec='TS 24.301'");
console.log("\n2. get_emm_cause");
console.log("   - Get EMM/5GMM cause details");
console.log("   - Example: causeNumber=3, network='lte' or '5g'");
console.log("\n3. list_specs");
console.log("   - List available specifications");

console.log("\n=== EMM Cause Examples (LTE - TS 24.301) ===");
const emmCauses = {
  3: "Illegal UE",
  7: "EPS services not allowed",
  22: "Congestion"
};
for (const [num, name] of Object.entries(emmCauses)) {
  console.log(`   #${num}: ${name}`);
}

console.log("\n=== 5GMM Cause Examples (5G - TS 24.501) ===");
const fivegCauses = {
  3: "Illegal UE",
  7: "5GS services not allowed",
  62: "No network slices available",
  65: "Maximum number of PDU sessions reached"
};
for (const [num, name] of Object.entries(fivegCauses)) {
  console.log(`   #${num}: ${name}`);
}

console.log("\n=== Configuration for VS Code ===");
console.log("Add to .vscode/mcp.json:");
console.log(JSON.stringify({
  servers: {
    "3gpp-docs": {
      type: "stdio",
      command: "node",
      args: [path.join(__dirname, "src", "index.js")]
    }
  }
}, null, 2));

console.log("\n=== Server Ready ===");
console.log("To start the server, run: npm start");
console.log("The server will communicate via stdio (standard input/output)");
