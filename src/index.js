#!/usr/bin/env node

/**
 * 3GPP Document Search MCP Server
 * 
 * AI가 3GPP 규격 문서를 검색할 수 있게 해주는 MCP 서버
 * 
 * Tools:
 * - search_3gpp_docs: 키워드로 3GPP 문서 검색
 * - get_emm_cause: EMM/5GMM cause 값 조회
 * - list_specs: 사용 가능한 규격 목록 조회
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 청크 데이터 경로 (환경변수 또는 기본 경로)
const CHUNKS_FILE = process.env.CHUNKS_FILE_PATH || 
  path.join(__dirname, "..", "data", "chunks.json");

// EMM Cause 테이블 (TS 24.301 Section 9.9.3.9)
const EMM_CAUSES = {
  2: { name: "IMSI unknown in HSS", description: "HSS에서 IMSI를 찾을 수 없음" },
  3: { name: "Illegal UE", description: "불법 UE - USIM이 EPS/non-EPS 서비스에 대해 무효화됨" },
  5: { name: "IMEI not accepted", description: "IMEI가 허용되지 않음" },
  6: { name: "Illegal ME", description: "불법 ME - 단말기가 허용되지 않음" },
  7: { name: "EPS services not allowed", description: "EPS 서비스 허용되지 않음" },
  8: { name: "EPS services and non-EPS services not allowed", description: "EPS 및 non-EPS 서비스 모두 허용되지 않음" },
  9: { name: "UE identity cannot be derived by the network", description: "네트워크에서 UE ID를 파악할 수 없음" },
  10: { name: "Implicitly detached", description: "암묵적 분리 - 네트워크에서 UE를 분리함" },
  11: { name: "PLMN not allowed", description: "PLMN 허용되지 않음 - forbidden PLMN에 추가" },
  12: { name: "Tracking Area not allowed", description: "Tracking Area 허용되지 않음" },
  13: { name: "Roaming not allowed in this tracking area", description: "이 TA에서 로밍 허용되지 않음" },
  14: { name: "EPS services not allowed in this PLMN", description: "이 PLMN에서 EPS 서비스 허용되지 않음" },
  15: { name: "No Suitable Cells In tracking area", description: "TA에 적합한 셀 없음" },
  16: { name: "MSC temporarily not reachable", description: "MSC 일시적 연결 불가" },
  17: { name: "Network failure", description: "네트워크 장애" },
  18: { name: "CS domain not available", description: "CS 도메인 사용 불가" },
  19: { name: "ESM failure", description: "ESM 실패" },
  20: { name: "MAC failure", description: "MAC 실패 - 인증 실패" },
  21: { name: "Synch failure", description: "동기화 실패" },
  22: { name: "Congestion", description: "혼잡 - 백오프 타이머 적용" },
  23: { name: "UE security capabilities mismatch", description: "UE 보안 능력 불일치" },
  24: { name: "Security mode rejected, unspecified", description: "보안 모드 거부" },
  25: { name: "Not authorized for this CSG", description: "CSG 권한 없음" },
  26: { name: "Non-EPS authentication unacceptable", description: "Non-EPS 인증 허용되지 않음" },
  31: { name: "Redirection to 5GCN required", description: "5G 코어로 리다이렉션 필요" },
  35: { name: "Requested service option not authorized in this PLMN", description: "이 PLMN에서 요청 서비스 옵션 권한 없음" },
  39: { name: "CS service temporarily not available", description: "CS 서비스 일시적 불가" },
  40: { name: "No EPS bearer context activated", description: "활성화된 EPS 베어러 컨텍스트 없음" },
  42: { name: "Severe network failure", description: "심각한 네트워크 장애" },
  78: { name: "PLMN not allowed to operate at the present UE location", description: "현재 UE 위치에서 PLMN 운영 불가 (위성)" },
  95: { name: "Semantically incorrect message", description: "의미적으로 잘못된 메시지" },
  96: { name: "Invalid mandatory information", description: "필수 정보 유효하지 않음" },
  97: { name: "Message type non-existent or not implemented", description: "메시지 타입 존재하지 않거나 미구현" },
  98: { name: "Message type not compatible with protocol state", description: "프로토콜 상태와 호환되지 않는 메시지 타입" },
  99: { name: "Information element non-existent or not implemented", description: "IE 존재하지 않거나 미구현" },
  100: { name: "Conditional IE error", description: "조건부 IE 오류" },
  101: { name: "Message not compatible with protocol state", description: "프로토콜 상태와 호환되지 않는 메시지" },
  111: { name: "Protocol error, unspecified", description: "프로토콜 오류 (미지정)" }
};

// 5GMM Cause 테이블 (TS 24.501 Section 9.11.3.2)
const FIVEGMM_CAUSES = {
  3: { name: "Illegal UE", description: "불법 UE" },
  5: { name: "PEI not accepted", description: "PEI 허용되지 않음" },
  6: { name: "Illegal ME", description: "불법 ME" },
  7: { name: "5GS services not allowed", description: "5GS 서비스 허용되지 않음" },
  9: { name: "UE identity cannot be derived by the network", description: "네트워크에서 UE ID 파악 불가" },
  10: { name: "Implicitly de-registered", description: "암묵적 등록 해제" },
  11: { name: "PLMN not allowed", description: "PLMN 허용되지 않음" },
  12: { name: "Tracking area not allowed", description: "TA 허용되지 않음" },
  13: { name: "Roaming not allowed in this tracking area", description: "이 TA에서 로밍 불가" },
  15: { name: "No suitable cells in tracking area", description: "TA에 적합한 셀 없음" },
  20: { name: "MAC failure", description: "MAC 실패" },
  21: { name: "Synch failure", description: "동기화 실패" },
  22: { name: "Congestion", description: "혼잡" },
  23: { name: "UE security capabilities mismatch", description: "UE 보안 능력 불일치" },
  24: { name: "Security mode rejected, unspecified", description: "보안 모드 거부" },
  26: { name: "Non-5G authentication unacceptable", description: "Non-5G 인증 불가" },
  27: { name: "N1 mode not allowed", description: "N1 모드 허용되지 않음" },
  28: { name: "Restricted service area", description: "제한된 서비스 구역" },
  31: { name: "Redirection to EPC required", description: "EPC로 리다이렉션 필요" },
  62: { name: "No network slices available", description: "사용 가능한 네트워크 슬라이스 없음" },
  65: { name: "Maximum number of PDU sessions reached", description: "최대 PDU 세션 수 도달" },
  67: { name: "Insufficient resources for specific slice and DNN", description: "특정 슬라이스/DNN에 리소스 부족" },
  69: { name: "Insufficient resources for specific slice", description: "특정 슬라이스에 리소스 부족" },
  71: { name: "ngKSI already in use", description: "ngKSI 이미 사용 중" },
  72: { name: "Non-3GPP access to 5GCN not allowed", description: "Non-3GPP 접속 허용되지 않음" },
  73: { name: "Serving network not authorized", description: "서빙 네트워크 권한 없음" },
  74: { name: "Temporarily not authorized for this SNPN", description: "이 SNPN에 일시적 권한 없음" },
  75: { name: "Permanently not authorized for this SNPN", description: "이 SNPN에 영구적 권한 없음" },
  76: { name: "Not authorized for this CAG", description: "이 CAG에 권한 없음" },
  90: { name: "Payload was not forwarded", description: "페이로드 전달되지 않음" },
  91: { name: "DNN not supported or not subscribed in the slice", description: "DNN 미지원 또는 슬라이스에 미가입" },
  95: { name: "Semantically incorrect message", description: "의미적으로 잘못된 메시지" },
  96: { name: "Invalid mandatory information", description: "필수 정보 유효하지 않음" },
  97: { name: "Message type non-existent or not implemented", description: "메시지 타입 미존재/미구현" },
  98: { name: "Message type not compatible with protocol state", description: "프로토콜 상태와 호환 불가" },
  99: { name: "Information element non-existent or not implemented", description: "IE 미존재/미구현" },
  100: { name: "Conditional IE error", description: "조건부 IE 오류" },
  101: { name: "Message not compatible with protocol state", description: "프로토콜 상태와 메시지 호환 불가" },
  111: { name: "Protocol error, unspecified", description: "프로토콜 오류 (미지정)" }
};

// 청크 데이터 로드
let chunksData = [];

async function loadChunks() {
  try {
    const data = await fs.readFile(CHUNKS_FILE, "utf-8");
    chunksData = JSON.parse(data);
    console.error(`[3GPP MCP] Loaded ${chunksData.length} chunks`);
  } catch (error) {
    console.error(`[3GPP MCP] Error loading chunks: ${error.message}`);
    chunksData = [];
  }
}

// 키워드 검색 함수
function searchChunks(query, specFilter = null, maxResults = 5) {
  const keywords = query.toLowerCase().split(/\s+/);
  
  let results = chunksData
    .filter(chunk => {
      // 규격 필터 적용
      if (specFilter) {
        const source = chunk.metadata?.source?.toLowerCase() || "";
        if (!source.includes(specFilter.toLowerCase().replace(/\s+/g, "").replace("ts", ""))) {
          return false;
        }
      }
      
      // 키워드 검색
      const content = chunk.content.toLowerCase();
      return keywords.every(kw => content.includes(kw));
    })
    .map(chunk => {
      const content = chunk.content.toLowerCase();
      const score = keywords.reduce((acc, kw) => acc + (content.match(new RegExp(kw, "g")) || []).length, 0);
      return { ...chunk, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
  
  return results;
}

// MCP 서버 생성
const server = new McpServer({
  name: "3gpp-docs",
  version: "1.0.0"
});

// Tool: search_3gpp_docs
server.tool(
  "search_3gpp_docs",
  "Search 3GPP specification documents (TS 24.008, TS 24.301, TS 24.501, TS 36.300) by keywords",
  {
    query: {
      type: "string",
      description: "Search query (e.g., 'EMM cause reject', 'attach procedure', 'tracking area update')"
    },
    spec: {
      type: "string",
      description: "Optional: Filter by specification (e.g., 'TS 24.301', 'TS 24.501')",
      optional: true
    },
    maxResults: {
      type: "number",
      description: "Maximum number of results to return (default: 5)",
      optional: true
    }
  },
  async ({ query, spec, maxResults = 5 }) => {
    if (chunksData.length === 0) {
      await loadChunks();
    }
    
    const results = searchChunks(query, spec, maxResults);
    
    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No results found for "${query}"${spec ? ` in ${spec}` : ""}`
          }
        ]
      };
    }
    
    const formattedResults = results.map((r, i) => {
      const source = r.metadata?.source || "Unknown";
      const preview = r.content.substring(0, 500) + (r.content.length > 500 ? "..." : "");
      return `[${i + 1}] Source: ${source}\n${preview}`;
    }).join("\n\n---\n\n");
    
    return {
      content: [
        {
          type: "text",
          text: `Found ${results.length} results for "${query}"${spec ? ` in ${spec}` : ""}:\n\n${formattedResults}`
        }
      ]
    };
  }
);

// Tool: get_emm_cause
server.tool(
  "get_emm_cause",
  "Get detailed information about EMM cause (LTE) or 5GMM cause (5G) values",
  {
    causeNumber: {
      type: "number",
      description: "The cause number (e.g., 3, 7, 15, 22)"
    },
    network: {
      type: "string",
      description: "Network type: 'lte' for EMM cause (TS 24.301), '5g' for 5GMM cause (TS 24.501). Default: 'lte'",
      optional: true
    }
  },
  async ({ causeNumber, network = "lte" }) => {
    const causes = network === "5g" ? FIVEGMM_CAUSES : EMM_CAUSES;
    const causeType = network === "5g" ? "5GMM" : "EMM";
    const spec = network === "5g" ? "TS 24.501" : "TS 24.301";
    
    const cause = causes[causeNumber];
    
    if (!cause) {
      // 유효하지 않은 cause는 #111로 처리
      const defaultCause = causes[111];
      return {
        content: [
          {
            type: "text",
            text: `${causeType} Cause #${causeNumber} is not defined.\nPer ${spec}, undefined cause values are treated as #111 "${defaultCause.name}".\n\nDescription: ${defaultCause.description}`
          }
        ]
      };
    }
    
    // 관련 문서 검색
    let additionalInfo = "";
    if (chunksData.length === 0) {
      await loadChunks();
    }
    
    const relatedDocs = searchChunks(`#${causeNumber} ${cause.name}`, spec, 2);
    if (relatedDocs.length > 0) {
      additionalInfo = "\n\n📄 Related specification text:\n" + 
        relatedDocs.map(r => r.content.substring(0, 400) + "...").join("\n\n");
    }
    
    return {
      content: [
        {
          type: "text",
          text: `## ${causeType} Cause #${causeNumber} (${spec})\n\n**Name:** ${cause.name}\n\n**Description:** ${cause.description}${additionalInfo}`
        }
      ]
    };
  }
);

// Tool: list_specs
server.tool(
  "list_specs",
  "List available 3GPP specifications in the database",
  {},
  async () => {
    if (chunksData.length === 0) {
      await loadChunks();
    }
    
    const sources = [...new Set(chunksData.map(c => c.metadata?.source || "Unknown"))];
    
    const specInfo = {
      "ts_124008": "TS 24.008 - 2G/3G NAS (MM/GMM/SM/CC)",
      "ts_124301": "TS 24.301 - LTE NAS (EMM/ESM)",
      "ts_124501": "TS 24.501 - 5G NAS (5GMM/5GSM)",
      "ts_136300": "TS 36.300 - E-UTRA Overall Description"
    };
    
    const specList = sources.map(s => {
      const key = s.split("_v")[0];
      return `- ${specInfo[key] || s}`;
    }).join("\n");
    
    return {
      content: [
        {
          type: "text",
          text: `## Available 3GPP Specifications\n\nTotal chunks: ${chunksData.length}\n\n${specList}\n\n### Usage Examples:\n- search_3gpp_docs: "EMM cause reject"\n- get_emm_cause: causeNumber=3, network="lte"\n- get_emm_cause: causeNumber=7, network="5g"`
        }
      ]
    };
  }
);

// 서버 시작
async function main() {
  // 청크 데이터 미리 로드
  await loadChunks();
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error("[3GPP MCP] Server started");
}

main().catch(console.error);
