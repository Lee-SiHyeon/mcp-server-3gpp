/**
 * Post-install script
 * Automatically prepares data after npm install
 * - Detects and installs Git LFS if needed
 * - Downloads chunks.json automatically
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
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

async function checkGitLFS() {
  try {
    await execAsync("git lfs version");
    return true;
  } catch {
    return false;
  }
}

async function installGitLFS() {
  console.log("📦 Installing Git LFS...");
  
  const platform = process.platform;
  
  try {
    if (platform === "win32") {
      // Windows: Download and install via winget or chocolatey
      try {
        console.log("   Trying winget...");
        await execAsync("winget install -e --id GitHub.GitLFS");
        console.log("   ✅ Git LFS installed via winget");
        return true;
      } catch {
        try {
          console.log("   Trying chocolatey...");
          await execAsync("choco install git-lfs -y");
          console.log("   ✅ Git LFS installed via chocolatey");
          return true;
        } catch {
          console.log("   ⚠️  Auto-install failed. Please install manually:");
          console.log("   https://git-lfs.github.com/");
          return false;
        }
      }
    } else if (platform === "darwin") {
      // macOS
      console.log("   Using Homebrew...");
      await execAsync("brew install git-lfs");
      console.log("   ✅ Git LFS installed via Homebrew");
      return true;
    } else if (platform === "linux") {
      // Linux
      console.log("   Using apt-get...");
      await execAsync("sudo apt-get install git-lfs -y");
      console.log("   ✅ Git LFS installed via apt-get");
      return true;
    }
  } catch (error) {
    console.log(`   ⚠️  Auto-install failed: ${error.message}`);
    console.log("   Please install Git LFS manually: https://git-lfs.github.com/");
    return false;
  }
  
  return false;
}

async function downloadChunksFile() {
  console.log("📥 Downloading chunks.json from Git LFS...");
  
  try {
    // Initialize Git LFS in this repo
    await execAsync("git lfs install");
    
    // Pull LFS files
    await execAsync("git lfs pull");
    
    console.log("   ✅ chunks.json downloaded successfully");
    return true;
  } catch (error) {
    console.log(`   ⚠️  Git LFS pull failed: ${error.message}`);
    console.log("\n   Trying alternative download method...");
    
    // Fallback: Direct download from GitHub
    try {
      const https = await import("https");
      const url = "https://github.com/Lee-SiHyeon/mcp-server-3gpp/raw/main/data/chunks.json";
      
      console.log(`   Downloading from: ${url}`);
      
      const file = await fs.open(CHUNKS_FILE, "w");
      
      await new Promise((resolve, reject) => {
        https.default.get(url, (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            // Follow redirect
            https.default.get(response.headers.location, (res) => {
              const stream = res.pipe(file.createWriteStream());
              stream.on("finish", resolve);
              stream.on("error", reject);
            });
          } else {
            const stream = response.pipe(file.createWriteStream());
            stream.on("finish", resolve);
            stream.on("error", reject);
          }
        }).on("error", reject);
      });
      
      await file.close();
      console.log("   ✅ chunks.json downloaded successfully (direct download)");
      return true;
    } catch (dlError) {
      console.log(`   ❌ Direct download failed: ${dlError.message}`);
      return false;
    }
  }
}

async function postInstall() {
  console.log("\n📦 MCP Server 3GPP - Post Install Setup\n");
  
  // Check if chunks.json already exists and is valid
  try {
    await fs.access(CHUNKS_FILE);
    const stats = await fs.stat(CHUNKS_FILE);
    
    // Check if it's a Git LFS pointer file (very small)
    if (stats.size < 1000) {
      console.log("⚠️  Git LFS pointer detected. Attempting to download actual data...\n");
      
      // Check if Git LFS is installed
      const hasLFS = await checkGitLFS();
      
      if (!hasLFS) {
        console.log("❌ Git LFS not found.");
        const installed = await installGitLFS();
        
        if (!installed) {
          console.log("\n⚠️  Cannot proceed without Git LFS.");
          console.log("   Manual options:");
          console.log("   1. Install Git LFS: https://git-lfs.github.com/");
          console.log("   2. Run: git lfs pull");
          console.log("   3. Or generate data yourself: npm run setup\n");
          return;
        }
      }
      
      // Download chunks.json
      const downloaded = await downloadChunksFile();
      
      if (!downloaded) {
        console.log("\n❌ Failed to download chunks.json");
        console.log("   Manual options:");
        console.log("   1. Run: git lfs pull");
        console.log("   2. Generate data: npm run setup");
        console.log("   3. Use EMM/5GMM cause lookup only (no document search)\n");
        return;
      }
      
      console.log("\n✅ Data setup complete!");
      return;
    }
    
    console.log("✅ Data already prepared (chunks.json exists)");
    console.log(`   Size: ${(stats.size / (1024 * 1024)).toFixed(1)} MB`);
    console.log("   17 specifications, 22,408 chunks ready\n");
    return;
  } catch {
    // File doesn't exist
    console.log("⚠️  chunks.json not found\n");
    
    // Check if Git LFS is installed
    const hasLFS = await checkGitLFS();
    
    if (!hasLFS) {
      console.log("❌ Git LFS not found. Installing...\n");
      const installed = await installGitLFS();
      
      if (!installed) {
        console.log("\n⚠️  Cannot auto-download data without Git LFS.");
        console.log("   Options:");
        console.log("   1. Install Git LFS manually: https://git-lfs.github.com/");
        console.log("   2. Generate data: npm run setup");
        console.log("   3. Use EMM/5GMM cause lookup only\n");
        return;
      }
    }
    
    // Try to download
    console.log("");
    const downloaded = await downloadChunksFile();
    
    if (downloaded) {
      console.log("\n✅ Data setup complete!");
    } else {
      console.log("\n⚠️  Auto-download failed.");
      console.log("   Options:");
      console.log("   1. Run: git lfs pull");
      console.log("   2. Generate data: npm run setup\n");
    }
  }
}

postInstall().catch((err) => {
  console.error("⚠️  Post-install error:", err.message);
  console.log("   The MCP server will still work for EMM/5GMM cause lookup.");
  console.log("   Run 'npm run setup' to generate full data.\n");
  process.exit(0); // Don't fail installation
});
