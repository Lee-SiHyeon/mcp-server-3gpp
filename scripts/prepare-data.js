/**
 * Data Preparation Script
 * 
 * Runs both extraction and chunking steps
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("=== 3GPP MCP Server Data Preparation ===\n");

// Step 1: Run Python extraction
console.log("Step 1: Extracting text from PDFs...\n");

const pythonScript = path.join(__dirname, "extract_pdf.py");
const python = spawn("python", [pythonScript], { stdio: "inherit" });

python.on("close", (code) => {
  if (code !== 0) {
    console.log("\nPython extraction failed or no PDFs found.");
    console.log("Please place PDF files in the 'raw/' folder first.");
    process.exit(1);
  }
  
  console.log("\n---\n");
  console.log("Step 2: Creating chunks...\n");
  
  // Step 2: Run chunking
  import("./create_chunks.js").catch(console.error);
});
