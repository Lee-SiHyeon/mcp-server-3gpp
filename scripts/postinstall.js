/**
 * Post-install script
 * Automatically prepares data after npm install
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const CHUNKS_FILE = path.join(DATA_DIR, "chunks.json");

async function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { 
      stdio: "inherit",
      shell: true 
    });
    
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    
    proc.on("error", reject);
  });
}

async function postInstall() {
  console.log("\n📦 MCP Server 3GPP - Post Install Setup\n");
  
  // Check if chunks.json already exists
  try {
    await fs.access(CHUNKS_FILE);
    const stats = await fs.stat(CHUNKS_FILE);
    
    // Check if it's a Git LFS pointer file (very small)
    if (stats.size < 1000) {
      console.log("⚠️  Git LFS pointer detected. Downloading actual data...");
      console.log("   Run: git lfs pull");
      console.log("\n   Or download manually from:");
      console.log("   https://github.com/Lee-SiHyeon/mcp-server-3gpp/raw/main/data/chunks.json\n");
      return;
    }
    
    console.log("✅ Data already prepared (chunks.json exists)");
    console.log(`   Size: ${(stats.size / (1024 * 1024)).toFixed(1)} MB`);
    console.log("   Run 'npm run prepare-data' to regenerate data\n");
    return;
  } catch {
    // File doesn't exist, continue
  }
  
  console.log("⚠️  No data found. Data preparation required.\n");
  console.log("📥 For pre-built data (17 specs, 22,408 chunks):");
  console.log("   Option 1: Install Git LFS and run 'git lfs pull'");
  console.log("   Option 2: Download manually from GitHub releases\n");
  console.log("🔧 To generate data yourself:");
  console.log("   1. Run 'npm run download-pdfs' to auto-download PDFs");
  console.log("   2. Or manually place PDFs in the 'raw/' folder");
  console.log("   3. Run 'npm run prepare-data' to generate chunks\n");
  console.log("ℹ️  The MCP server will work with EMM/5GMM cause lookup even without data.");
  console.log("   Full document search requires data preparation.\n");
}

postInstall().catch((err) => {
  console.error("Post-install warning:", err.message);
  process.exit(0); // Don't fail installation
});
