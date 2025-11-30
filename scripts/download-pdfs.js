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
  // === NAS Layer (Non-Access Stratum) ===
  {
    name: "ts_124008",
    url: "https://www.3gpp.org/ftp/Specs/archive/24_series/24.008/24008-h90.zip",
    description: "TS 24.008 - 2G/3G NAS (MM/GMM/SM)",
    category: "NAS"
  },
  {
    name: "ts_124301",
    url: "https://www.3gpp.org/ftp/Specs/archive/24_series/24.301/24301-h90.zip",
    description: "TS 24.301 - LTE NAS (EMM/ESM)",
    category: "NAS"
  },
  {
    name: "ts_124501",
    url: "https://www.3gpp.org/ftp/Specs/archive/24_series/24.501/24501-h90.zip",
    description: "TS 24.501 - 5G NAS (5GMM/5GSM)",
    category: "NAS"
  },
  
  // === RF (Radio Frequency) ===
  {
    name: "ts_151010",
    url: "https://www.3gpp.org/ftp/Specs/archive/51_series/51.010-1/51010-1-h00.zip",
    description: "TS 51.010-1 - 2G RF",
    category: "RF"
  },
  {
    name: "ts_134121",
    url: "https://www.3gpp.org/ftp/Specs/archive/34_series/34.121/34121-1-h00.zip",
    description: "TS 34.121-1 - 3G RF",
    category: "RF"
  },
  {
    name: "ts_136521",
    url: "https://www.3gpp.org/ftp/Specs/archive/36_series/36.521-1/36521-1-h00.zip",
    description: "TS 36.521-1 - 4G RF",
    category: "RF"
  },
  {
    name: "ts_138521",
    url: "https://www.3gpp.org/ftp/Specs/archive/38_series/38.521-1/38521-1-h00.zip",
    description: "TS 38.521-1 - 5G RF (FR1)",
    category: "RF"
  },
  {
    name: "ts_138521_3",
    url: "https://www.3gpp.org/ftp/Specs/archive/38_series/38.521-3/38521-3-h00.zip",
    description: "TS 38.521-3 - 5G RF SA(FR1)",
    category: "RF"
  },
  {
    name: "ts_138521_4",
    url: "https://www.3gpp.org/ftp/Specs/archive/38_series/38.521-4/38521-4-h00.zip",
    description: "TS 38.521-4 - 5G De-mod/Perf",
    category: "RF"
  },
  {
    name: "ts_138533",
    url: "https://www.3gpp.org/ftp/Specs/archive/38_series/38.533/38533-h00.zip",
    description: "TS 38.533 - 5G RRM",
    category: "RF"
  },
  
  // === RCT (Radio Conformance Test) ===
  {
    name: "ts_134123",
    url: "https://www.3gpp.org/ftp/Specs/archive/34_series/34.123-1/34123-1-h00.zip",
    description: "TS 34.123-1 - 3G Protocol",
    category: "RCT"
  },
  {
    name: "ts_136523",
    url: "https://www.3gpp.org/ftp/Specs/archive/36_series/36.523-1/36523-1-h00.zip",
    description: "TS 36.523-1 - 4G Protocol",
    category: "RCT"
  },
  {
    name: "ts_138523",
    url: "https://www.3gpp.org/ftp/Specs/archive/38_series/38.523-1/38523-1-h00.zip",
    description: "TS 38.523-1 - 5G Protocol",
    category: "RCT"
  },
  
  // === Protocol Specs ===
  {
    name: "ts_131121",
    url: "https://www.3gpp.org/ftp/Specs/archive/31_series/31.121/31121-h00.zip",
    description: "TS 31.121 - USIM",
    category: "Protocol"
  },
  {
    name: "ts_131124",
    url: "https://www.3gpp.org/ftp/Specs/archive/31_series/31.124/31124-h00.zip",
    description: "TS 31.124 - USAT",
    category: "Protocol"
  },
  
  // === IMS (IP Multimedia Subsystem) ===
  {
    name: "ts_134229_1",
    url: "https://www.3gpp.org/ftp/Specs/archive/34_series/34.229-1/34229-1-h00.zip",
    description: "TS 34.229-1 - 4G IMS",
    category: "IMS"
  },
  {
    name: "ts_134229_5",
    url: "https://www.3gpp.org/ftp/Specs/archive/34_series/34.229-5/34229-5-h00.zip",
    description: "TS 34.229-5 - 5G IMS",
    category: "IMS"
  },
  
  // === RSE (Radio Side Equipment) ===
  {
    name: "ts_136124",
    url: "https://www.3gpp.org/ftp/Specs/archive/36_series/36.124/36124-h00.zip",
    description: "TS 36.124 - 4G RSE",
    category: "RSE"
  },
  {
    name: "ts_138124",
    url: "https://www.3gpp.org/ftp/Specs/archive/38_series/38.124/38124-h00.zip",
    description: "TS 38.124 - 5G RSE",
    category: "RSE"
  },
  
  // === Architecture & Overview ===
  {
    name: "ts_136300",
    url: "https://www.3gpp.org/ftp/Specs/archive/36_series/36.300/36300-h90.zip",
    description: "TS 36.300 - E-UTRA Overall Description",
    category: "Architecture"
  },
  {
    name: "ts_138300",
    url: "https://www.3gpp.org/ftp/Specs/archive/38_series/38.300/38300-h00.zip",
    description: "TS 38.300 - NR Overall Description",
    category: "Architecture"
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
  console.log("🔽 Downloading 3GPP specifications for NAD Team...\n");
  
  await fs.mkdir(RAW_DIR, { recursive: true });
  
  // Group by category
  const categories = {};
  PDF_SOURCES.forEach(source => {
    if (!categories[source.category]) {
      categories[source.category] = [];
    }
    categories[source.category].push(source);
  });
  
  console.log(`Total specs: ${PDF_SOURCES.length}`);
  console.log("Categories:", Object.keys(categories).join(", "));
  console.log();
  
  for (const source of PDF_SOURCES) {
    const destPath = path.join(RAW_DIR, `${source.name}.zip`);
    
    console.log(`[${source.category}] ${source.description}`);
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
  console.log("\n📊 Summary:");
  Object.entries(categories).forEach(([cat, specs]) => {
    console.log(`  ${cat}: ${specs.length} specs`);
  });
  console.log("\nNote: Some PDFs may be in ZIP format. Please extract them to the raw/ folder.");
  console.log("Then run: npm run prepare-data");
}

downloadPDFs().catch(console.error);
