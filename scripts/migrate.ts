import { loadEnv } from "./lib/env";
import { getDb } from "../src/db/client";
import { ensureSchema } from "../src/db/schema";

async function main() {
  loadEnv();
  const db = getDb();
  await ensureSchema(db);
  console.log("schema ready");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
