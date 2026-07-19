/**
 * Cloudflare D1 REST API 클라이언트 (읽기 전용 웹앱용).
 *
 * D1은 Workers 바인딩이 기본이지만, Vercel(Node)에서는 REST `/query`로 접근한다.
 * libSQL의 `execute({ sql, args })` 인터페이스와 반환 형태(.rows/.rowsAffected)를 흉내내어
 * API 라우트 코드를 그대로 쓸 수 있게 한다.
 *
 * 제약(무료): 쿼리당 바인딩 파라미터 100개, 문장 100KB, DB 500MB.
 * 웹앱 읽기는 단일 파라미터 쿼리라 제약에 걸리지 않는다. 대량 쓰기는 scripts/sync-d1.ts(wrangler) 담당.
 */

export interface D1Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

export interface ResultRow {
  [column: string]: unknown;
}
export interface ResultSet {
  rows: ResultRow[];
  rowsAffected: number;
  columns: string[];
}

type Args = unknown[] | Record<string, unknown>;

function readConfig(): D1Config | null {
  const accountId = process.env.CF_ACCOUNT_ID;
  const databaseId = process.env.CF_D1_DATABASE_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!accountId || !databaseId || !apiToken) return null;
  return { accountId, databaseId, apiToken };
}

export function hasD1Config(): boolean {
  return readConfig() !== null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isTransient(msg: string): boolean {
  return (
    /HTTP 5\d\d/.test(msg) ||
    /HTTP 429/.test(msg) ||
    /fetch failed/.test(msg) ||
    /ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR/.test(msg)
  );
}

/** libSQL 호환 클라이언트(읽기 경로에서 쓰는 execute만 구현) */
export class D1HttpClient {
  private readonly cfg: D1Config;
  private readonly endpoint: string;

  constructor(cfg: D1Config) {
    this.cfg = cfg;
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/d1/database/${cfg.databaseId}/query`;
  }

  async execute(stmt: string | { sql: string; args?: Args }): Promise<ResultSet> {
    const sql = typeof stmt === "string" ? stmt : stmt.sql;
    const rawArgs = typeof stmt === "string" ? [] : stmt.args ?? [];
    // 라우트 코드는 위치 인자(?)만 사용 → 배열로 정규화
    const params = Array.isArray(rawArgs) ? rawArgs : Object.values(rawArgs);

    let lastError = "";
    for (let attempt = 0; attempt <= 4; attempt++) {
      try {
        const res = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.cfg.apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sql, params }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        const json = (await res.json()) as {
          success: boolean;
          errors?: { message: string }[];
          result?: {
            results?: ResultRow[];
            success?: boolean;
            meta?: { rows_read?: number; rows_written?: number; changes?: number };
          }[];
        };
        if (!json.success) {
          throw new Error(`D1 error: ${JSON.stringify(json.errors ?? []).slice(0, 200)}`);
        }
        const first = json.result?.[0];
        const rows = first?.results ?? [];
        return {
          rows,
          rowsAffected: first?.meta?.changes ?? 0,
          columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        };
      } catch (e) {
        lastError = String(e);
        if (!isTransient(lastError) || attempt === 4) throw e;
        await sleep(500 * Math.pow(2, attempt));
      }
    }
    throw new Error(lastError);
  }
}

let cached: D1HttpClient | null = null;

/** D1 설정이 있으면 클라이언트, 없으면 null */
export function getD1(): D1HttpClient | null {
  if (cached) return cached;
  const cfg = readConfig();
  if (!cfg) return null;
  cached = new D1HttpClient(cfg);
  return cached;
}
