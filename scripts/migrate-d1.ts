/** D1에 스키마 생성 (읽기모델 테이블 DDL — REST로 실행) */
import { loadEnv } from "./lib/env";
import { getD1 } from "../src/db/d1-http";
import { ensureSchema } from "../src/db/schema";

async function main() {
  loadEnv();
  const d1 = getD1();
  if (!d1) {
    console.error("CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN 가 없습니다.");
    process.exit(1);
  }
  await ensureSchema(d1);
  console.log("D1 schema ready");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
