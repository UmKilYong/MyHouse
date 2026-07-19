import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { getD1, hasD1Config, type ResultSet } from "./d1-http";

let fileClient: Client | null = null;

/**
 * 로컬 SQLite 파일 클라이언트 (수집기·동기화·마이그레이션용).
 * 수집기는 항상 로컬에 쓴다 — 대량 쓰기를 로컬에서 처리하고 D1엔 델타만 동기화한다.
 */
export function getDb(): Client {
  if (!fileClient) {
    const url = process.env.LOCAL_DB_URL || "file:data/house.db";
    if (url.startsWith("file:")) {
      const dir = path.dirname(url.slice("file:".length));
      if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
    }
    fileClient = createClient({ url });
    // 동시 수집기(naver·trades·sync)가 같은 파일을 써도 충돌하지 않도록:
    // WAL = 읽기/쓰기 동시 허용, busy_timeout = 잠금 시 즉시 에러 대신 대기
    if (url.startsWith("file:")) {
      fileClient.execute("PRAGMA journal_mode=WAL").catch(() => {});
      fileClient.execute("PRAGMA busy_timeout=30000").catch(() => {});
    }
  }
  return fileClient;
}

/** 읽기 전용 최소 인터페이스 — libSQL Client과 D1HttpClient 모두 만족 */
export interface ReadClient {
  execute(stmt: string | { sql: string; args?: unknown[] }): Promise<{
    rows: Record<string, unknown>[];
    rowsAffected?: number;
  }>;
}
// ResultSet 재노출 (호출부 타입 편의)
export type { ResultSet };

/**
 * 웹앱(API 라우트) 읽기용 DB.
 * - 배포(Vercel): D1 REST 클라이언트 (CF_* env 존재)
 * - 로컬 개발: 로컬 SQLite 파일 (D1 env 없음)
 */
export function getReadDb(): ReadClient {
  if (hasD1Config()) {
    return getD1() as ReadClient;
  }
  return getDb() as unknown as ReadClient;
}
