/**
 * Create Chunks from Extracted Text Files
 * 
 * Usage:
 *   node scripts/create_chunks.js
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTRACTED_DIR = path.join(__dirname, "..", "extracted");
const OUTPUT_FILE = path.join(__dirname, "..", "data", "chunks.json");

const CHUNK_SIZE = 3000;
const OVERLAP = 200;

async function createChunks() {
  console.log("Creating chunks from extracted text files...\n");
  
  // Check if extracted directory exists
  try {
    await fs.access(EXTRACTED_DIR);
  } catch {
    console.log(`Directory '${EXTRACTED_DIR}' not found.`);
    console.log("Please run 'python scripts/extract_pdf.py' first.");
    return;
  }
  
  // Get text files
  const files = (await fs.readdir(EXTRACTED_DIR)).filter(f => f.endsWith(".txt"));
  
  if (files.length === 0) {
    console.log("No text files found in extracted/ directory.");
    console.log("Please run 'python scripts/extract_pdf.py' first.");
    return;
  }
  
  console.log(`Found ${files.length} text file(s)`);
  
  const allChunks = [];
  
  for (const file of files) {
    const filePath = path.join(EXTRACTED_DIR, file);
    const content = await fs.readFile(filePath, "utf-8");
    const source = file.replace(".txt", "");
    
    console.log(`Processing: ${file} (${content.length.toLocaleString()} chars)`);
    
    // Split into chunks
    let start = 0;
    let chunkIndex = 0;
    
    while (start < content.length) {
      const end = Math.min(start + CHUNK_SIZE, content.length);
      const chunkText = content.slice(start, end);
      
      allChunks.push({
        id: `${source}_chunk_${chunkIndex}`,
        content: chunkText,
        metadata: {
          source: source,
          chunk_index: chunkIndex,
          start_char: start,
          end_char: end
        }
      });
      
      chunkIndex++;
      start = end - OVERLAP;
      
      if (start >= content.length) break;
    }
    
    console.log(`  Created ${chunkIndex} chunks`);
  }
  
  // Save chunks
  const dataDir = path.dirname(OUTPUT_FILE);
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(allChunks, null, 2));
  
  console.log(`\nTotal chunks: ${allChunks.length.toLocaleString()}`);
  console.log(`Saved to: ${OUTPUT_FILE}`);
  console.log("\nData preparation complete!");
  console.log("You can now start the MCP server with 'npm start'");
}

createChunks().catch(console.error);
