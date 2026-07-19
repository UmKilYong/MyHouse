/**
 * 로컬 SQLite(data/house.db) 임의 SQL 조회 헬퍼 — 분석·디버깅용.
 *
 * 사용법:
 *   npm run q "SELECT COUNT(*) FROM articles WHERE is_active=1"
 *   npm run q "SELECT * FROM complexes LIMIT 5" -- --table   # 표 형태 출력
 *
 * 읽기 전용 권장(로컬 원본 DB이니 실수 방지). 결과는 JSON(기본) 또는 콘솔 표.
 */
import { loadEnv } from "./lib/env";
import { getDb } from "../src/db/client";

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const asTable = args.includes("--table");
  const sql = args.filter((a) => a !== "--table").join(" ").trim();
  if (!sql) {
    console.error('사용법: npm run q "SELECT ..."  (표: 끝에 -- --table)');
    process.exit(1);
  }
  const db = getDb();
  const rs = await db.execute(sql);
  const rows = rs.rows as unknown as Record<string, unknown>[];
  if (asTable) console.table(rows);
  else console.log(JSON.stringify(rows, null, 2));
  console.error(`(${rows.length} rows)`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
