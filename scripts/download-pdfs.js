/**
 * Automatic PDF Download Script
 * Downloads 3GPP specifications from official sources
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_DIR = path.join(__dirname, "..", "raw");

// 3GPP PDF download URLs (latest versions)
const PDF_SOURCES = [
  {
    name: "ts_124008",
    url: "https://www.3gpp.org/ftp/Specs/archive/24_series/24.008/24008-h90.zip",
    description: "TS 24.008 - 2G/3G NAS"
  },
  {
    name: "ts_124301",
    url: "https://www.3gpp.org/ftp/Specs/archive/24_series/24.301/24301-h90.zip",
    description: "TS 24.301 - LTE NAS"
  },
  {
    name: "ts_124501",
    url: "https://www.3gpp.org/ftp/Specs/archive/24_series/24.501/24501-h90.zip",
    description: "TS 24.501 - 5G NAS"
  },
  {
    name: "ts_136300",
    url: "https://www.3gpp.org/ftp/Specs/archive/36_series/36.300/36300-h90.zip",
    description: "TS 36.300 - E-UTRA Overall"
  }
];

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        https.get(response.headers.location, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve();
          });
        }).on("error", reject);
      } else {
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      }
    }).on("error", reject);
    
    file.on("error", (err) => {
      fs.unlink(destPath);
      reject(err);
    });
  });
}

async function downloadPDFs() {
  console.log("🔽 Downloading 3GPP specifications...\n");
  
  await fs.mkdir(RAW_DIR, { recursive: true });
  
  for (const source of PDF_SOURCES) {
    const destPath = path.join(RAW_DIR, `${source.name}.zip`);
    
    console.log(`Downloading: ${source.description}`);
    console.log(`  URL: ${source.url}`);
    
    try {
      await downloadFile(source.url, destPath);
      console.log(`  ✅ Saved to: ${destPath}\n`);
    } catch (error) {
      console.log(`  ⚠️ Failed: ${error.message}`);
      console.log(`  Please download manually from: https://www.3gpp.org/specifications\n`);
    }
  }
  
  console.log("Download complete!");
  console.log("\nNote: Some PDFs may be in ZIP format. Please extract them to the raw/ folder.");
  console.log("Then run: npm run prepare-data");
}

downloadPDFs().catch(console.error);
