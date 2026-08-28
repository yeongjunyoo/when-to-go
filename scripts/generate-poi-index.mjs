#!/usr/bin/env node
// B-index generator. Fetches areaBasedList2 POI candidates for a fixed set
// of target sigungu and writes web/src/generated/poi-index.generated.json
// with the real-data marker set.
//
// ★ THIS SCRIPT MUST NEVER RUN WITHOUT EXPLICIT LOCAL-STORAGE APPROVAL.
// It refuses to run unless GENERATE_INDEX_APPROVED=true is set in the
// environment — a separate, explicit confirmation from the human operator
// that local-storage approval has actually been granted, distinct from
// (and in addition to) the app's own VITE_LOCAL_STORAGE_APPROVED runtime
// flag. This script writing real data is the one action that changes this
// project's persistence posture; it does not happen by accident.
//
// Quota note: fully paginating areaBasedList2 for N sigungu costs ~1-2
// calls/sigungu (see M0 measurement: 종로 1p, 제주 2p, others 1p each).
// Keep TARGET_SIGUNGU small and intentional.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUTPUT_PATH = path.join(ROOT, "web/src/generated/poi-index.generated.json");
const REAL_DATA_MARKER = "__WTG_INDEX_REAL_DATA_MARKER__";

const UPSTREAM_BASE = "https://apis.data.go.kr/B551011/";
const MOBILE_APP = "언제가지";
const MOBILE_OS = "ETC";
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

// Same 6-sigungu M0 measurement scope; adjust deliberately, not by habit.
const TARGET_SIGUNGU = [
  { lDongRegnCd: "51", lDongSignguCd: "130", sidoName: "강원특별자치도", signguName: "원주시" },
  { lDongRegnCd: "11", lDongSignguCd: "110", sidoName: "서울특별시", signguName: "종로구" },
  { lDongRegnCd: "51", lDongSignguCd: "110", sidoName: "강원특별자치도", signguName: "춘천시" },
  { lDongRegnCd: "47", lDongSignguCd: "130", sidoName: "경상북도", signguName: "경주시" },
  { lDongRegnCd: "26", lDongSignguCd: "110", sidoName: "부산광역시", signguName: "중구" },
  { lDongRegnCd: "50", lDongSignguCd: "110", sidoName: "제주특별자치도", signguName: "제주시" },
];

function requireApproval() {
  if (process.env.GENERATE_INDEX_APPROVED !== "true") {
    console.error(
      "REFUSED: GENERATE_INDEX_APPROVED=true is required to run this script.\n" +
        "This confirms local-storage approval has been granted before any real-data\n" +
        "index is written. Set the env var explicitly and re-run — do not set it in a\n" +
        "shared shell profile or CI default."
    );
    process.exit(1);
  }
}

function requireKey() {
  const key = process.env.TOURAPI_KEY?.trim();
  if (!key) {
    console.error("TOURAPI_KEY environment variable is required. The key must never be hardcoded.");
    process.exit(1);
  }
  return key;
}

async function fetchAllPoi(serviceKey, lDongRegnCd, lDongSignguCd) {
  const items = [];
  let pageNo = 1;
  let knownTotal = null;
  while (pageNo <= MAX_PAGES) {
    const url = new URL("KorService2/areaBasedList2", UPSTREAM_BASE);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("MobileOS", MOBILE_OS);
    url.searchParams.set("MobileApp", MOBILE_APP);
    url.searchParams.set("_type", "json");
    url.searchParams.set("numOfRows", String(PAGE_SIZE));
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("lDongRegnCd", lDongRegnCd);
    url.searchParams.set("lDongSignguCd", lDongSignguCd);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`upstream HTTP ${res.status} for ${lDongRegnCd}/${lDongSignguCd} page ${pageNo}`);
    const body = await res.json();
    const resultCode = body?.response?.header?.resultCode;
    if (resultCode !== "0000") throw new Error(`upstream resultCode=${resultCode} for ${lDongRegnCd}/${lDongSignguCd} page ${pageNo}`);

    const bodyField = body.response.body;
    const totalCount = Number(bodyField?.totalCount ?? 0);
    knownTotal = totalCount;
    const rawItem = bodyField?.items?.item;
    const pageItems = Array.isArray(rawItem) ? rawItem : rawItem ? [rawItem] : [];
    for (const raw of pageItems) {
      items.push({
        contentid: String(raw.contentid ?? ""),
        title: String(raw.title ?? ""),
        addr1: String(raw.addr1 ?? ""),
        mapx: String(raw.mapx ?? ""),
        mapy: String(raw.mapy ?? ""),
      });
    }

    if (knownTotal !== null && items.length >= knownTotal) break;
    if (pageItems.length < PAGE_SIZE) break;
    pageNo += 1;
  }
  return items;
}

async function main() {
  requireApproval();
  const serviceKey = requireKey();

  const entries = [];
  for (const target of TARGET_SIGUNGU) {
    console.log(`fetching ${target.sidoName} ${target.signguName}...`);
    const pois = await fetchAllPoi(serviceKey, target.lDongRegnCd, target.lDongSignguCd);
    entries.push({ ...target, pois });
    console.log(`  ${pois.length} POI candidates`);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    entries,
    [REAL_DATA_MARKER]: true,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf8");
  console.log(`wrote ${OUTPUT_PATH} (${entries.length} sigungu, real-data marker set)`);
}

main().catch((err) => {
  console.error("generate-poi-index failed:", err.message);
  process.exit(1);
});
