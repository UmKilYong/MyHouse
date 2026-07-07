import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

let client: Client | null = null;

/**
 * Turso(TURSO_DATABASE_URL) 또는 로컬 SQLite 파일(data/house.db).
 * 웹 서버와 수집 스크립트가 동일하게 사용한다.
 */
export function getDb(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL || "file:data/house.db";
    if (url.startsWith("file:")) {
      const dir = path.dirname(url.slice("file:".length));
      if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
    }
    client = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}
