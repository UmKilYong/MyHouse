/**
 * 로컬 SQLite → Cloudflare D1 델타 동기화.
 *
 * 웹앱이 읽는 "읽기모델" 테이블만, 그중 **바뀐 행만** D1로 보낸다.
 *  - 값 인라인 SQL(바인딩 파라미터 0개)로 D1 REST에 전송 → 100개 파라미터 제한 회피
 *  - 문장당 100KB 이하로 청크
 *  - 하루 쓰기 예산(기본 90,000행) 준수 — 초과분은 다음 실행에서 이어서
 *  - 변경 감지는 로컬 d1_sync_state(테이블·키·해시)로 self-contained
 *
 * 사용법: CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN 설정 후
 *   npm run sync:d1
 *   npm run sync:d1 -- --budget 50000
 */
import { loadEnv } from "./lib/env";
import { getDb } from "../src/db/client";
import { getD1, D1WriteLimitError } from "../src/db/d1-http";

const MAX_SQL_BYTES = 90_000; // 문장 100KB 제한 여유
const DEFAULT_BUDGET = 90_000; // D1 무료 쓰기 10만/일 여유

const KEY_SEP = String.fromCharCode(1); // 복합키 구분자 (데이터에 없는 제어문자)

interface TableSync {
  name: string;
  keyCols: string[];
  numKeyCols?: string[]; // 숫자 affinity 키 컬럼 (DELETE 리터럴에서 따옴표 없이)
  cols: string[]; // 키 포함 전체 컬럼
  where?: string; // 로컬에서 가져올 행 필터(가지치기)
}

// 최근 N일/년 가지치기 기준
function kstDaysAgo(n: number): string {
  return new Date(Date.now() + 9 * 3600 * 1000 - n * 86400_000).toISOString().slice(0, 10);
}

function tableConfigs(): TableSync[] {
  const daily35 = kstDaysAgo(35);
  const trades2y = kstDaysAgo(730);
  return [
    { name: "regions", keyCols: ["cortar_no"], cols: ["cortar_no", "name", "city", "division", "lat", "lng", "active"] },
    { name: "complexes", keyCols: ["complex_no"], cols: ["complex_no", "name", "cortar_no", "lat", "lng", "total_households", "total_buildings", "use_approve_ymd", "deal_count", "kb_serial", "updated_at"] },
    { name: "articles", keyCols: ["article_no"], where: `is_active=1 AND price < ${Number(process.env.MAX_PRICE_MANWON || 100000)}`, cols: ["article_no", "complex_no", "price", "area_supply", "area_exclusive", "area_name", "floor_info", "direction", "building_name", "description", "tag_list", "same_addr_cnt", "realtor_name", "confirm_ymd", "initial_price", "first_seen_at", "last_seen_at", "is_active"] },
    { name: "complex_area_stats", keyCols: ["complex_no", "area_group"], numKeyCols: ["area_group"], cols: ["complex_no", "area_group", "min_ask", "avg_ask", "ask_count", "recent_trade_avg", "recent_trade_count", "peak_trade_price", "peak_trade_date", "updated_at"] },
    { name: "complex_kb_price", keyCols: ["complex_no", "area_group"], numKeyCols: ["area_group"], cols: ["complex_no", "area_group", "kb_price", "updated_at"] },
    // complex_daily_stats: D1 미동기화(용량·쓰기 과다). 전일/전주/전월 변동율은 배포 사이트에서 비활성.
    { name: "complex_trade_map", keyCols: ["complex_no", "sgg_code", "umd_name", "apt_name"], cols: ["complex_no", "sgg_code", "umd_name", "apt_name"] },
    { name: "trades", keyCols: ["id"], numKeyCols: ["id"], where: `deal_date >= '${trades2y}'`, cols: ["id", "sgg_code", "umd_name", "apt_name", "area_exclusive", "deal_date", "price", "floor", "canceled"] },
    { name: "collect_runs", keyCols: ["id"], numKeyCols: ["id"], where: "id > (SELECT COALESCE(MAX(id),0)-30 FROM collect_runs)", cols: ["id", "kind", "started_at", "finished_at", "status", "detail"] },
  ];
}

const byteLen = (s: string) => Buffer.byteLength(s, "utf8");

// 매 수집마다 값과 무관하게 바뀌는 휘발성 컬럼 — 해시에서 제외(불필요한 재동기화 방지).
// last_seen_at: 활성 매물마다 매번 now / updated_at: 통계·KB 재계산마다 now. 앱은 이 값을 화면에 쓰지 않음.
const HASH_SKIP = new Set(["updated_at", "last_seen_at"]);

/** SQL 리터럴 (문자열 이스케이프, null/숫자 처리) */
function lit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** DELETE용 키 리터럴 — 숫자 키는 따옴표 없이(affinity 매칭), 그 외 문자열 */
function litKey(col: string, val: string, numKeyCols?: string[]): string {
  if (numKeyCols?.includes(col)) return String(Number(val));
  return `'${val.replace(/'/g, "''")}'`;
}

/** 간단·안정 해시 (행 값 → 문자열) */
function hashRow(cols: string[], row: Record<string, unknown>): string {
  let h = 5381;
  const s = cols.filter((c) => !HASH_SKIP.has(c)).map((c) => `${row[c] ?? " "}`).join("|");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

function keyOf(keyCols: string[], row: Record<string, unknown>): string {
  return keyCols.map((c) => String(row[c])).join(KEY_SEP);
}

async function ensureStateTable(db: ReturnType<typeof getDb>) {
  await db.execute(`CREATE TABLE IF NOT EXISTS d1_sync_state (
    table_name TEXT NOT NULL, row_key TEXT NOT NULL, hash TEXT NOT NULL,
    PRIMARY KEY (table_name, row_key)
  )`);
}

async function main() {
  loadEnv();
  const d1 = getD1();
  if (!d1) {
    console.error("CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN 가 없습니다.");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const bIdx = args.indexOf("--budget");
  let budget = bIdx >= 0 ? Number(args[bIdx + 1]) : DEFAULT_BUDGET;

  const db = getDb();
  await ensureStateTable(db);

  // --rehash: 해시 공식 변경 후, D1 전송 없이 로컬 상태 해시만 새 공식으로 재계산.
  // (이미 동기화된 행이 공식 변경만으로 전량 재전송되는 것을 방지. 신규/삭제 행은 건드리지 않음)
  if (args.includes("--rehash")) {
    let updated = 0;
    for (const t of tableConfigs()) {
      const rs = await db.execute(
        `SELECT ${t.cols.join(", ")} FROM ${t.name}${t.where ? ` WHERE ${t.where}` : ""}`
      );
      const curHash = new Map<string, string>();
      for (const row of rs.rows as unknown as Record<string, unknown>[]) {
        curHash.set(keyOf(t.keyCols, row), hashRow(t.cols, row));
      }
      const stRs = await db.execute({
        sql: `SELECT row_key FROM d1_sync_state WHERE table_name = ?`,
        args: [t.name],
      });
      const stmts = [];
      for (const r of stRs.rows as unknown as { row_key: string }[]) {
        const k = String(r.row_key);
        const h = curHash.get(k);
        if (h !== undefined) {
          stmts.push({
            sql: `UPDATE d1_sync_state SET hash=? WHERE table_name=? AND row_key=?`,
            args: [h, t.name, k],
          });
        }
      }
      for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500), "write");
      updated += stmts.length;
      console.log(`${t.name}: ${stmts.length}행 해시 재계산`);
    }
    console.log(`재계산 완료: ${updated}행 (D1 전송 없음)`);
    return;
  }

  let totalUpserts = 0;
  let totalDeletes = 0;

  try {
  for (const t of tableConfigs()) {
    if (budget <= 0) {
      console.log(`예산 소진 — ${t.name} 이후는 다음 실행에서`);
      break;
    }
    // 로컬 현재 행
    const rs = await db.execute(
      `SELECT ${t.cols.join(", ")} FROM ${t.name}${t.where ? ` WHERE ${t.where}` : ""}`
    );
    const current = new Map<string, Record<string, unknown>>();
    const curHash = new Map<string, string>();
    for (const row of rs.rows as unknown as Record<string, unknown>[]) {
      const k = keyOf(t.keyCols, row);
      current.set(k, row);
      curHash.set(k, hashRow(t.cols, row));
    }

    // 이전 동기화 상태
    const stRs = await db.execute({
      sql: `SELECT row_key, hash FROM d1_sync_state WHERE table_name = ?`,
      args: [t.name],
    });
    const prev = new Map<string, string>();
    for (const r of stRs.rows as unknown as { row_key: string; hash: string }[]) {
      prev.set(String(r.row_key), String(r.hash));
    }

    // upsert 대상(신규·변경), delete 대상(사라짐)
    const toUpsert: string[] = [];
    for (const [k, h] of curHash) {
      if (prev.get(k) !== h) toUpsert.push(k);
    }
    const toDelete: string[] = [];
    for (const k of prev.keys()) {
      if (!current.has(k)) toDelete.push(k);
    }

    if (toUpsert.length === 0 && toDelete.length === 0) {
      console.log(`${t.name}: 변경 없음`);
      continue;
    }

    // 예산 내에서만 처리
    const budgetedUpsert = toUpsert.slice(0, budget);
    budget -= budgetedUpsert.length;
    const budgetedDelete = budget > 0 ? toDelete.slice(0, budget) : [];
    budget -= budgetedDelete.length;

    // --- UPSERT: 값 인라인 multi-row INSERT ... ON CONFLICT ---
    const updateSet = t.cols
      .filter((c) => !t.keyCols.includes(c))
      .map((c) => `${c}=excluded.${c}`)
      .join(", ");
    const conflictSet = updateSet
      ? `ON CONFLICT(${t.keyCols.join(",")}) DO UPDATE SET ${updateSet}`
      : `ON CONFLICT(${t.keyCols.join(",")}) DO NOTHING`;
    const header = `INSERT INTO ${t.name} (${t.cols.join(",")}) VALUES `;

    const conflictBytes = byteLen(conflictSet);
    const headerBytes = byteLen(header);
    let batch: string[] = [];
    let batchBytes = headerBytes;
    const flushUpsert = async () => {
      if (batch.length === 0) return;
      const sql = header + batch.join(",") + " " + conflictSet;
      await d1.execute(sql);
      batch = [];
      batchBytes = headerBytes;
    };
    for (const k of budgetedUpsert) {
      const row = current.get(k)!;
      const tuple = `(${t.cols.map((c) => lit(row[c])).join(",")})`;
      const tb = byteLen(tuple);
      if (batchBytes + tb + conflictBytes + 2 > MAX_SQL_BYTES) {
        await flushUpsert();
      }
      batch.push(tuple);
      batchBytes += tb + 1;
    }
    await flushUpsert();

    // --- DELETE: 행값 IN 청크 ---
    const delHeader = `DELETE FROM ${t.name} WHERE (${t.keyCols.join(",")}) IN (`;
    const delHeaderBytes = byteLen(delHeader);
    let delBatch: string[] = [];
    let delBytes = delHeaderBytes;
    const flushDelete = async () => {
      if (delBatch.length === 0) return;
      await d1.execute(delHeader + delBatch.join(",") + ")");
      delBatch = [];
      delBytes = delHeaderBytes;
    };
    for (const k of budgetedDelete) {
      const vals = k.split(KEY_SEP);
      const tuple = `(${t.keyCols.map((c, i) => litKey(c, vals[i], t.numKeyCols)).join(",")})`;
      const tb = byteLen(tuple);
      if (delBytes + tb + 2 > MAX_SQL_BYTES) await flushDelete();
      delBatch.push(tuple);
      delBytes += tb + 1;
    }
    await flushDelete();

    // 로컬 상태 갱신 (실제 보낸 것만)
    const stateStmts = [];
    for (const k of budgetedUpsert) {
      stateStmts.push({
        sql: `INSERT INTO d1_sync_state (table_name,row_key,hash) VALUES (?,?,?)
              ON CONFLICT(table_name,row_key) DO UPDATE SET hash=excluded.hash`,
        args: [t.name, k, curHash.get(k)!],
      });
    }
    for (const k of budgetedDelete) {
      stateStmts.push({ sql: `DELETE FROM d1_sync_state WHERE table_name=? AND row_key=?`, args: [t.name, k] });
    }
    for (let i = 0; i < stateStmts.length; i += 500) {
      await db.batch(stateStmts.slice(i, i + 500), "write");
    }

    totalUpserts += budgetedUpsert.length;
    totalDeletes += budgetedDelete.length;
    const carry = toUpsert.length - budgetedUpsert.length + (toDelete.length - budgetedDelete.length);
    console.log(
      `${t.name}: upsert ${budgetedUpsert.length}, delete ${budgetedDelete.length}` +
        (carry > 0 ? ` (남은 ${carry}은 다음 실행)` : "")
    );
  }

  } catch (e) {
    if (e instanceof D1WriteLimitError) {
      console.log("D1 일일 쓰기 한도 도달 — 동기화 중단(내일 UTC 자정 리셋 후 이어감)");
    } else { throw e; }
  }
  console.log(`동기화 완료: upsert ${totalUpserts}, delete ${totalDeletes}, 잔여 예산 ${budget}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
