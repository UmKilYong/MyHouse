/**
 * KB시세 수집기 — 보금자리론(매매가·KB시세 6억 이하) 판정용.
 *
 * 사용법:
 *   npm run collect:kb                # 전체 (주 1회 실행 권장 — KB시세는 매주 금요일 갱신)
 *   npm run collect:kb -- --city 광명시
 *   npm run collect:kb -- --max-tiles 5   # 테스트용
 *
 * 흐름:
 *  1. 우리 단지 좌표를 ~1.3km 타일로 묶어 KB 지도 API로 타일별 KB 단지 목록 수집
 *  2. 좌표(±80m) + 정규화 이름으로 우리 단지 ↔ KB 단지 매칭 (complexes.kb_serial)
 *  3. 매칭된 단지별 평형 시세(mpriByType) → complex_kb_price (그룹 내 최대 일반거래가 = 보수적 판정)
 */
import { loadEnv } from "./lib/env";
import { getDb } from "../src/db/client";
import { ensureSchema } from "../src/db/schema";
import { nowIso } from "./lib/dates";
import { fetchKbComplexesInBbox, fetchKbTypePrices, type KbComplex } from "./lib/kb-client";
import type { Client, InStatement } from "@libsql/client";

const TILE_LAT = 0.012; // ≈1.3km
const TILE_LNG = 0.015;
const MATCH_DISTANCE_M = 80;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    city: get("--city"),
    maxTiles: get("--max-tiles") ? Number(get("--max-tiles")) : undefined,
  };
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[\s\-·.']/g, "")
    .replace(/아파트/g, "")
    .replace(/이편한세상/g, "e편한세상")
    .replace(/제(\d)/g, "$1");
}

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLng = (lng2 - lng1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

interface OurComplex {
  complex_no: string;
  name: string;
  lat: number;
  lng: number;
}

async function main() {
  loadEnv();
  const opts = parseArgs();
  const db = getDb();
  await ensureSchema(db);

  const runRs = await db.execute({
    sql: `INSERT INTO collect_runs (kind, started_at, status) VALUES ('kb', ?, 'running') RETURNING id`,
    args: [nowIso()],
  });
  const runId = Number(runRs.rows[0].id);

  try {
    // 활성 지역(regions.active=1)의 단지만 대상 (비활성 지역 제외)
    const complexesRs = await db.execute({
      sql: opts.city
        ? `SELECT c.complex_no, c.name, c.lat, c.lng FROM complexes c
           JOIN regions r ON r.cortar_no = c.cortar_no WHERE r.active = 1 AND r.city = ?`
        : `SELECT c.complex_no, c.name, c.lat, c.lng FROM complexes c
           JOIN regions r ON r.cortar_no = c.cortar_no WHERE r.active = 1`,
      args: opts.city ? [opts.city] : [],
    });
    const ours = complexesRs.rows as unknown as OurComplex[];
    if (ours.length === 0) throw new Error("complexes가 비어 있습니다. 먼저 collect:naver를 실행하세요.");

    // 1. 타일 구성
    const tiles = new Map<string, OurComplex[]>();
    for (const c of ours) {
      const key = `${Math.floor(c.lat / TILE_LAT)}|${Math.floor(c.lng / TILE_LNG)}`;
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key)!.push(c);
    }
    let tileEntries = [...tiles.entries()];
    if (opts.maxTiles) tileEntries = tileEntries.slice(0, opts.maxTiles);
    console.log(`단지 ${ours.length}개 → 타일 ${tileEntries.length}개`);

    // 2. 타일별 KB 단지 수집 + 매칭
    let matched = 0;
    const kbSerialByComplex = new Map<string, number>();
    for (const [i, [key, tileComplexes]] of tileEntries.entries()) {
      const [latIdx, lngIdx] = key.split("|").map(Number);
      const kbList = await fetchKbComplexesInBbox(
        latIdx * TILE_LAT - 0.001,
        (latIdx + 1) * TILE_LAT + 0.001,
        lngIdx * TILE_LNG - 0.001,
        (lngIdx + 1) * TILE_LNG + 0.001
      );
      for (const our of tileComplexes) {
        const candidates = kbList
          .map((kb: KbComplex) => ({
            kb,
            dist: distanceM(our.lat, our.lng, kb.wgs84위도, kb.wgs84경도),
          }))
          .filter((x) => x.dist <= MATCH_DISTANCE_M)
          .sort((a, b) => a.dist - b.dist);
        if (candidates.length === 0) continue;
        const ourNorm = normalizeName(our.name);
        // 이름 유사(정규화 일치·포함) 우선, 없으면 40m 이내 최근접
        const byName = candidates.find(({ kb }) => {
          const n = normalizeName(kb.단지명);
          return n === ourNorm || (n.length >= 3 && ourNorm.length >= 3 && (n.includes(ourNorm) || ourNorm.includes(n)));
        });
        const pick = byName ?? (candidates[0].dist <= 40 ? candidates[0] : undefined);
        if (!pick) continue;
        kbSerialByComplex.set(our.complex_no, pick.kb.단지기본일련번호);
        matched++;
      }
      if ((i + 1) % 50 === 0) console.log(`타일 [${i + 1}/${tileEntries.length}] 매칭 누적 ${matched}`);
    }
    console.log(`매칭 완료: ${matched}/${ours.length} 단지`);

    const serialStmts: InStatement[] = [...kbSerialByComplex.entries()].map(([no, serial]) => ({
      sql: `UPDATE complexes SET kb_serial=? WHERE complex_no=?`,
      args: [serial, no],
    }));
    for (let i = 0; i < serialStmts.length; i += 500) {
      await db.batch(serialStmts.slice(i, i + 500), "write");
    }

    // 3. 단지별 평형 시세 (동일 KB단지를 공유하는 우리 단지는 한 번만 조회)
    const bySerial = new Map<number, string[]>();
    for (const [no, serial] of kbSerialByComplex) {
      if (!bySerial.has(serial)) bySerial.set(serial, []);
      bySerial.get(serial)!.push(no);
    }
    const now = nowIso();
    let priced = 0;
    let done = 0;
    for (const [serial, complexNos] of bySerial) {
      done++;
      let types;
      try {
        types = await fetchKbTypePrices(serial);
      } catch (e) {
        console.log(`시세 조회 실패 (serial ${serial}): ${String(e).slice(0, 100)}`);
        continue;
      }
      // 평형 그룹별 최대 일반거래가 (보수적 판정: 그룹 내 모든 타입이 기준 이하일 때만 통과)
      const byGroup = new Map<number, number>();
      for (const t of types) {
        if (t.시세제공여부 !== "1" || t.매매일반거래가 == null) continue;
        const g = Math.trunc(Number(t.전용면적));
        if (!Number.isFinite(g)) continue;
        byGroup.set(g, Math.max(byGroup.get(g) ?? 0, Number(t.매매일반거래가)));
      }
      if (byGroup.size === 0) continue;
      const stmts: InStatement[] = [];
      for (const no of complexNos) {
        for (const [g, price] of byGroup) {
          stmts.push({
            sql: `INSERT INTO complex_kb_price (complex_no, area_group, kb_price, updated_at)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT(complex_no, area_group) DO UPDATE SET
                    kb_price=excluded.kb_price, updated_at=excluded.updated_at`,
            args: [no, g, price, now],
          });
          priced++;
        }
      }
      await db.batch(stmts, "write");
      if (done % 200 === 0) console.log(`시세 [${done}/${bySerial.size}] 그룹 누적 ${priced}`);
    }

    await db.execute({
      sql: `UPDATE collect_runs SET finished_at=?, status='success', detail=? WHERE id=?`,
      args: [nowIso(), JSON.stringify({ complexes: ours.length, matched, pricedGroups: priced }), runId],
    });
    console.log(`완료: 매칭 ${matched}, 시세 그룹 ${priced}`);
  } catch (e) {
    await db.execute({
      sql: `UPDATE collect_runs SET finished_at=?, status='error', detail=? WHERE id=?`,
      args: [nowIso(), String(e), runId],
    });
    throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
