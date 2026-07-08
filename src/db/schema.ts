import type { Client } from "@libsql/client";

export const SCHEMA_STATEMENTS: string[] = [
  // 수집 대상 지역 (법정동 단위)
  `CREATE TABLE IF NOT EXISTS regions (
    cortar_no TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    division TEXT NOT NULL DEFAULT '',
    lat REAL,
    lng REAL,
    active INTEGER NOT NULL DEFAULT 1
  )`,

  // 아파트 단지
  `CREATE TABLE IF NOT EXISTS complexes (
    complex_no TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cortar_no TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    total_households INTEGER,
    total_buildings INTEGER,
    use_approve_ymd TEXT,
    deal_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_complexes_cortar ON complexes(cortar_no)`,
  `CREATE INDEX IF NOT EXISTS idx_complexes_latlng ON complexes(lat, lng)`,

  // 매물 (매매 호가)
  `CREATE TABLE IF NOT EXISTS articles (
    article_no TEXT PRIMARY KEY,
    complex_no TEXT NOT NULL,
    price INTEGER NOT NULL,
    area_supply REAL,
    area_exclusive REAL,
    area_name TEXT,
    floor_info TEXT,
    direction TEXT,
    building_name TEXT,
    description TEXT,
    tag_list TEXT,
    same_addr_cnt INTEGER NOT NULL DEFAULT 1,
    realtor_name TEXT,
    confirm_ymd TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS idx_articles_complex ON articles(complex_no, is_active)`,
  `CREATE INDEX IF NOT EXISTS idx_articles_active_area ON articles(is_active, area_exclusive)`,

  // 매물 호가 변동 이력
  `CREATE TABLE IF NOT EXISTS article_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_no TEXT NOT NULL,
    price INTEGER NOT NULL,
    seen_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_aph_article ON article_price_history(article_no)`,

  // 국토부 실거래
  `CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sgg_code TEXT NOT NULL,
    umd_name TEXT NOT NULL,
    apt_name TEXT NOT NULL,
    area_exclusive REAL NOT NULL,
    deal_date TEXT NOT NULL,
    price INTEGER NOT NULL,
    floor INTEGER,
    canceled INTEGER NOT NULL DEFAULT 0,
    UNIQUE(sgg_code, umd_name, apt_name, area_exclusive, deal_date, price, floor)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_trades_key ON trades(sgg_code, umd_name, apt_name)`,

  // 실거래 수집 완료 월 기록 (백필 진행 추적)
  `CREATE TABLE IF NOT EXISTS trade_fetch_log (
    sgg_code TEXT NOT NULL,
    deal_ym TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    trade_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (sgg_code, deal_ym)
  )`,

  // 네이버 단지 ↔ 국토부 실거래 매칭 (이름 정규화 기반, 실거래 수집 시 갱신)
  `CREATE TABLE IF NOT EXISTS complex_trade_map (
    complex_no TEXT NOT NULL,
    sgg_code TEXT NOT NULL,
    umd_name TEXT NOT NULL,
    apt_name TEXT NOT NULL,
    PRIMARY KEY (complex_no, sgg_code, umd_name, apt_name)
  )`,

  // 단지·평형 그룹별 사전 집계 (수집 시 갱신, 조회 시 조인)
  `CREATE TABLE IF NOT EXISTS complex_area_stats (
    complex_no TEXT NOT NULL,
    area_group INTEGER NOT NULL,
    min_ask INTEGER,
    avg_ask INTEGER,
    ask_count INTEGER NOT NULL DEFAULT 0,
    recent_trade_avg INTEGER,
    recent_trade_count INTEGER NOT NULL DEFAULT 0,
    peak_trade_price INTEGER,
    peak_trade_date TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (complex_no, area_group)
  )`,

  // 단지·평형 그룹별 일별 스냅샷 (전일/전주/전월 변동율)
  `CREATE TABLE IF NOT EXISTS complex_daily_stats (
    complex_no TEXT NOT NULL,
    area_group INTEGER NOT NULL,
    date TEXT NOT NULL,
    min_price INTEGER NOT NULL,
    avg_price INTEGER NOT NULL,
    article_count INTEGER NOT NULL,
    PRIMARY KEY (complex_no, area_group, date)
  )`,

  // 수집 실행 이력
  `CREATE TABLE IF NOT EXISTS collect_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    detail TEXT
  )`,
];

// 기존 테이블에 추가된 컬럼 (없으면 추가, 있으면 무시)
const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  {
    table: "regions",
    column: "last_collected_at",
    ddl: `ALTER TABLE regions ADD COLUMN last_collected_at TEXT`,
  },
];

export async function ensureSchema(db: Client): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.execute(stmt);
  }
  for (const m of COLUMN_MIGRATIONS) {
    try {
      await db.execute(m.ddl);
    } catch (e) {
      if (!String(e).includes("duplicate column")) throw e;
    }
  }
}
