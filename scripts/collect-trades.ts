/**
 * 국토부 아파트 매매 실거래가 수집기 — 실거래가 공개시스템 CSV 다운로드 방식.
 * (rt.molit.go.kr 조건별 자료제공 — API 키 불필요)
 *
 * 사용법:
 *   npm run collect:trades                 # 미수집 연도 백필 + 최근 2개년 갱신
 *   npm run collect:trades -- --from 2015  # 백필 시작 연도 지정
 *   npm run collect:trades -- --sgg 41210  # 특정 시군구만
 *
 * 시군구·연 단위로 CSV를 받아 trades에 upsert.
 * 수집 후 단지↔실거래 매칭(complex_trade_map)과 complex_area_stats 실거래 컬럼 갱신.
 */
import { loadEnv } from "./lib/env";
import { getDb } from "../src/db/client";
import { ensureSchema } from "../src/db/schema";
import { nowIso } from "./lib/dates";
import type { Client, InStatement } from "@libsql/client";

const PAGE_URL = "https://rt.molit.go.kr/pt/xls/xls.do?mobileAt=";
const CSV_URL = "https://rt.molit.go.kr/pt/xls/ptXlsCSVDown.do";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DELAY_MS = 1500;
const DEFAULT_BACKFILL_FROM_YEAR = 2015;

const SIDO_BY_PREFIX: Record<string, { code: string; name: string }> = {
  "11": { code: "11000", name: "서울특별시" },
  "28": { code: "28000", name: "인천광역시" },
  "41": { code: "41000", name: "경기도" },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 국토부 CSV는 하루 100건 다운로드 제한 — 도달 시 정상 중단(다음 실행에서 이어받음) */
class DailyLimitError extends Error {}

interface TradeRow {
  umdName: string;
  aptName: string;
  areaExclusive: number;
  dealDate: string;
  price: number;
  floor: number | null;
  canceled: boolean;
}

let sessionCookie: string | null = null;

async function getSessionCookie(force = false): Promise<string> {
  if (sessionCookie && !force) return sessionCookie;
  const res = await fetch(PAGE_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`rt.molit.go.kr 접속 실패: HTTP ${res.status}`);
  sessionCookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return sessionCookie;
}

/** CSV 한 줄 → 따옴표 필드 배열 ("92,000" 내부 콤마 처리) */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"/g)) out.push(m[1]);
  return out;
}

function parseCsv(text: string): TradeRow[] {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.startsWith('"NO"'));
  if (headerIdx < 0) return [];
  const header = parseCsvLine(lines[headerIdx]);
  const col = (name: string) => header.findIndex((h) => h.includes(name));
  const iSgg = col("시군구");
  const iApt = col("단지명");
  const iArea = col("전용면적");
  const iYm = col("계약년월");
  const iDay = col("계약일");
  const iPrice = col("거래금액");
  const iFloor = col("층");
  const iCancel = col("해제사유발생일");

  const rows: TradeRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const f = parseCsvLine(lines[i]);
    if (f.length < header.length) continue;
    const ym = f[iYm];
    const day = f[iDay].padStart(2, "0");
    const price = Number(f[iPrice].replace(/,/g, ""));
    const area = Number(f[iArea]);
    if (!ym || !Number.isFinite(price) || !Number.isFinite(area)) continue;
    // "경기도 광명시 철산동" → "철산동"
    const umdName = f[iSgg].trim().split(/\s+/).pop() ?? "";
    const floorNum = Number(f[iFloor]);
    rows.push({
      umdName,
      aptName: f[iApt].trim(),
      areaExclusive: area,
      dealDate: `${ym.slice(0, 4)}-${ym.slice(4, 6)}-${day}`,
      price,
      floor: Number.isFinite(floorNum) ? floorNum : null,
      canceled: f[iCancel] !== "-" && f[iCancel] !== "",
    });
  }
  return rows;
}

async function fetchYearCsv(sgg: string, year: number): Promise<TradeRow[]> {
  const sido = SIDO_BY_PREFIX[sgg.slice(0, 2)];
  if (!sido) throw new Error(`지원하지 않는 시도 코드: ${sgg}`);
  const form = new URLSearchParams({
    srhThingNo: "A", // 아파트
    srhDelngSecd: "1", // 매매
    srhAddrGbn: "1",
    srhLfstsSecd: "1",
    srhNewRonSecd: "",
    srhSidoCd: sido.code,
    srhSggCd: sgg,
    srhEmdCd: "",
    srhLoadCd: "",
    srhHsmpCd: "",
    srhArea: "",
    srhLrArea: "",
    srhFromDt: `${year}-01-01`,
    srhToDt: `${year}-12-31`,
    srhFromAmount: "",
    srhToAmount: "",
    srhRoadNm: "",
    sidoNm: sido.name,
    sggNm: "",
    emdNm: "",
    loadNm: "",
    areaNm: "",
    hsmpNm: "",
    mobileAt: "",
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const cookie = await getSessionCookie(attempt > 0);
      const res = await fetch(CSV_URL, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          Referer: PAGE_URL,
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
        body: form.toString(),
        // 국토부 서버가 느릴 때 기본 10초 연결 타임아웃으로 실패 → 30초로 완화
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const text = new TextDecoder("euc-kr").decode(buf);
      if (text.includes("error") && text.length < 500) {
        // 일일 다운로드 100건 제한 → 재시도 무의미, 즉시 중단 신호
        if (text.includes("초과") || text.includes("100")) {
          throw new DailyLimitError(text.slice(0, 200));
        }
        throw new Error(text.slice(0, 200));
      }
      return parseCsv(text);
    } catch (e) {
      if (e instanceof DailyLimitError) throw e; // 재시도하지 않음
      lastError = e;
      await sleep(5000 * (attempt + 1));
    }
  }
  throw lastError;
}

async function saveYear(db: Client, sgg: string, year: number, rows: TradeRow[]): Promise<void> {
  const stmts: InStatement[] = rows.map((t) => ({
    sql: `INSERT INTO trades (sgg_code, umd_name, apt_name, area_exclusive, deal_date, price, floor, canceled)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(sgg_code, umd_name, apt_name, area_exclusive, deal_date, price, floor)
          DO UPDATE SET canceled=excluded.canceled`,
    args: [sgg, t.umdName, t.aptName, t.areaExclusive, t.dealDate, t.price, t.floor, t.canceled ? 1 : 0],
  }));
  stmts.push({
    sql: `INSERT INTO trade_fetch_log (sgg_code, deal_ym, fetched_at, trade_count)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(sgg_code, deal_ym) DO UPDATE SET
            fetched_at=excluded.fetched_at, trade_count=excluded.trade_count`,
    args: [sgg, `Y${year}`, nowIso(), rows.length],
  });
  // 대량 insert를 500개 단위로 나눠 실행 (Turso HTTP 요청 크기 제한 대비)
  for (let i = 0; i < stmts.length; i += 500) {
    await db.batch(stmts.slice(i, i + 500), "write");
  }
}

/** 아파트명 정규화: 공백/괄호/특수문자 제거 + 표기 차이 통일 후 비교 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[\s\-·.']/g, "")
    .replace(/아파트/g, "") // "미도아파트2차" ↔ "미도2차"
    .replace(/이편한세상/g, "e편한세상") // 국토부 "이편한세상" ↔ 네이버 "e편한세상"
    .replace(/제(\d)/g, "$1"); // "제1단지" ↔ "1단지"
}

/** 네이버 단지 ↔ 실거래 (sgg, umd, apt_name) 매칭 테이블 재구축 */
async function rebuildTradeMap(db: Client): Promise<number> {
  const complexesRs = await db.execute(
    `SELECT c.complex_no, c.name AS complex_name, c.cortar_no, r.name AS region_name
     FROM complexes c JOIN regions r ON r.cortar_no = c.cortar_no`
  );
  const tradeKeysRs = await db.execute(
    `SELECT DISTINCT sgg_code, umd_name, apt_name FROM trades`
  );

  const byArea = new Map<string, { aptName: string; norm: string }[]>();
  for (const row of tradeKeysRs.rows) {
    const key = `${row.sgg_code}|${row.umd_name}`;
    if (!byArea.has(key)) byArea.set(key, []);
    byArea.get(key)!.push({
      aptName: String(row.apt_name),
      norm: normalizeName(String(row.apt_name)),
    });
  }

  const stmts: InStatement[] = [{ sql: `DELETE FROM complex_trade_map`, args: [] }];
  let matched = 0;
  for (const row of complexesRs.rows) {
    const sgg = String(row.cortar_no).slice(0, 5);
    const key = `${sgg}|${row.region_name}`;
    const candidates = byArea.get(key);
    if (!candidates) continue;
    const norm = normalizeName(String(row.complex_name));
    let hits = candidates.filter((c) => c.norm === norm);
    if (hits.length === 0) {
      hits = candidates.filter(
        (c) => c.norm.length >= 3 && norm.length >= 3 && (c.norm.includes(norm) || norm.includes(c.norm))
      );
    }
    for (const h of hits) {
      stmts.push({
        sql: `INSERT OR IGNORE INTO complex_trade_map (complex_no, sgg_code, umd_name, apt_name) VALUES (?, ?, ?, ?)`,
        args: [row.complex_no, sgg, row.region_name, h.aptName],
      });
    }
    if (hits.length > 0) matched++;
  }
  for (let i = 0; i < stmts.length; i += 500) {
    await db.batch(stmts.slice(i, i + 500), "write");
  }
  return matched;
}

/** complex_area_stats의 실거래 컬럼 갱신 (최근 6개월 평균 + 역대 최고가) */
async function updateTradeStats(db: Client): Promise<void> {
  const now = nowIso();
  const sixMonthsAgo = new Date(Date.now() - 183 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  await db.execute({
    sql: `INSERT INTO complex_area_stats
            (complex_no, area_group, ask_count, recent_trade_avg, recent_trade_count,
             peak_trade_price, peak_trade_date, updated_at)
          SELECT m.complex_no,
                 CAST(t.area_exclusive AS INTEGER),
                 0,
                 CAST(AVG(CASE WHEN t.deal_date >= ? THEN t.price END) AS INTEGER),
                 SUM(CASE WHEN t.deal_date >= ? THEN 1 ELSE 0 END),
                 MAX(t.price),
                 SUBSTR(MAX(printf('%09d|%s', t.price, t.deal_date)), 11),
                 ?
          FROM complex_trade_map m
          JOIN trades t ON t.sgg_code = m.sgg_code
                       AND t.umd_name = m.umd_name
                       AND t.apt_name = m.apt_name
          WHERE t.canceled = 0
          GROUP BY m.complex_no, CAST(t.area_exclusive AS INTEGER)
          ON CONFLICT(complex_no, area_group) DO UPDATE SET
            recent_trade_avg=excluded.recent_trade_avg,
            recent_trade_count=excluded.recent_trade_count,
            peak_trade_price=excluded.peak_trade_price,
            peak_trade_date=excluded.peak_trade_date,
            updated_at=excluded.updated_at`,
    args: [sixMonthsAgo, sixMonthsAgo, now],
  });
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf("--from");
  const backfillFromYear = Number(
    fromIdx >= 0
      ? args[fromIdx + 1]
      : process.env.TRADES_BACKFILL_FROM_YEAR || DEFAULT_BACKFILL_FROM_YEAR
  );

  const db = getDb();
  await ensureSchema(db);

  const runRs = await db.execute({
    sql: `INSERT INTO collect_runs (kind, started_at, status) VALUES ('trades', ?, 'running') RETURNING id`,
    args: [nowIso()],
  });
  const runId = Number(runRs.rows[0].id);

  try {
    const sggRs = await db.execute(
      `SELECT DISTINCT SUBSTR(cortar_no, 1, 5) AS sgg FROM regions WHERE active=1 ORDER BY sgg`
    );
    let sggCodes = sggRs.rows.map((r) => String(r.sgg));
    const sggIdx = args.indexOf("--sgg");
    if (sggIdx >= 0) sggCodes = sggCodes.filter((s) => s === args[sggIdx + 1]);
    if (sggCodes.length === 0) {
      throw new Error("regions가 비어 있습니다. 먼저 collect:naver를 실행하세요.");
    }

    const fetchedRs = await db.execute(`SELECT sgg_code, deal_ym FROM trade_fetch_log`);
    const fetched = new Set(fetchedRs.rows.map((r) => `${r.sgg_code}|${r.deal_ym}`));
    const currentYear = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();

    let totalTrades = 0;
    let fetchedYears = 0;
    let limitHit = false;
    outer: for (const sgg of sggCodes) {
      for (let year = backfillFromYear; year <= currentYear; year++) {
        // 최근 2개년은 항상 재수집 (지연 신고·해제 반영), 과거는 1회만
        if (year < currentYear - 1 && fetched.has(`${sgg}|Y${year}`)) continue;
        let rows;
        try {
          rows = await fetchYearCsv(sgg, year);
        } catch (e) {
          if (e instanceof DailyLimitError) {
            console.log(
              `일일 다운로드 100건 제한 도달 — 실거래 수집 중단 (이번 ${fetchedYears}건 수집, 나머지는 다음 실행에서 이어받음)`
            );
            limitHit = true;
            break outer;
          }
          throw e;
        }
        await saveYear(db, sgg, year, rows);
        totalTrades += rows.length;
        fetchedYears++;
        console.log(`${sgg} ${year}: ${rows.length}건`);
        await sleep(DELAY_MS);
      }
    }

    const matched = await rebuildTradeMap(db);
    await updateTradeStats(db);
    console.log(`단지 매칭: ${matched}개, 실거래 통계 갱신 완료`);

    await db.execute({
      sql: `UPDATE collect_runs SET finished_at=?, status='success', detail=? WHERE id=?`,
      args: [nowIso(), JSON.stringify({ sggCount: sggCodes.length, fetchedYears, totalTrades, matched, limitHit }), runId],
    });
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
