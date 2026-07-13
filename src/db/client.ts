import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

let client: Client | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Turso가 간헐적으로 반환하는 일시적 오류(502/5xx/429/네트워크)인지 */
function isTransient(err: unknown): boolean {
  const msg = String(err);
  return (
    /HTTP status 5\d\d/.test(msg) ||
    /HTTP status 429/.test(msg) ||
    /SERVER_ERROR/.test(msg) ||
    /fetch failed/.test(msg) ||
    /ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR/.test(msg)
  );
}

/** 일시적 오류면 지수 백오프로 재시도, 결정적 오류(SQL 오류 등)는 즉시 던짐 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const MAX = 5;
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransient(e) || attempt === MAX) throw e;
      lastError = e;
      const delay = 1000 * Math.pow(2, attempt); // 1s,2s,4s,8s,16s
      console.warn(`[db] ${label} 일시적 오류, ${delay}ms 후 재시도 (${attempt + 1}/${MAX}): ${String(e).slice(0, 120)}`);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Turso(TURSO_DATABASE_URL) 또는 로컬 SQLite 파일(data/house.db).
 * 웹 서버와 수집 스크립트가 동일하게 사용한다.
 * execute/batch는 Turso의 간헐적 5xx/네트워크 오류에 대해 재시도한다.
 */
export function getDb(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL || "file:data/house.db";
    if (url.startsWith("file:")) {
      const dir = path.dirname(url.slice("file:".length));
      if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
    }
    const raw = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    const rawExecute = raw.execute.bind(raw);
    const rawBatch = raw.batch.bind(raw);
    // 원격(Turso)일 때만 재시도 래핑 (로컬 파일은 일시 오류가 없음)
    if (!url.startsWith("file:")) {
      raw.execute = ((...args: Parameters<typeof rawExecute>) =>
        withRetry(() => rawExecute(...args), "execute")) as typeof raw.execute;
      raw.batch = ((...args: Parameters<typeof rawBatch>) =>
        withRetry(() => rawBatch(...args), "batch")) as typeof raw.batch;
    }
    client = raw;
  }
  return client;
}
