/**
 * 네이버 부동산 매물(아파트 매매 호가) 수집기.
 *
 * 사용법:
 *   npm run collect:naver                  # 전체 대상 지역 수집
 *   npm run collect:naver -- --city 광명시  # 특정 시만
 *   npm run collect:naver -- --refresh-regions  # 지역/동 목록 재발견
 *
 * 흐름: 대상 시(5개) → 구 → 동(regions) → 동별 단지 목록 → 단지별 매물
 * 수집 후 complex_area_stats(호가 집계)와 complex_daily_stats(일별 스냅샷) 갱신.
 */
import { loadEnv } from "./lib/env";
import { getDb } from "../src/db/client";
import { ensureSchema } from "../src/db/schema";
import { kstToday, nowIso } from "./lib/dates";
import {
  fetchArticlesPage,
  fetchChildRegions,
  fetchComplexes,
  parsePriceToManwon,
} from "./lib/naver-client";
import type { Client, InStatement } from "@libsql/client";

// 수집 대상: 광명, 안양, 인천, 서울, 고양
const TARGETS = [
  { seedCortarNo: "1100000000", city: "서울특별시", cityFilter: null as string[] | null },
  { seedCortarNo: "2800000000", city: "인천광역시", cityFilter: null },
  { seedCortarNo: "4100000000", city: "경기도", cityFilter: ["광명시", "안양시", "고양시"] },
];

const MAX_ARTICLE_PAGES = 60;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    city: get("--city"),
    refreshRegions: args.includes("--refresh-regions"),
    maxComplexes: get("--max-complexes") ? Number(get("--max-complexes")) : undefined,
  };
}

/** 경기도 dvsn 이름("안양시 만안구")에서 시 이름을 뽑는다 */
function cityOfDivision(divisionName: string, filter: string[]): string | null {
  return filter.find((c) => divisionName.startsWith(c)) ?? null;
}

async function discoverRegions(db: Client): Promise<void> {
  console.log("지역(동) 목록 발견 중...");
  const stmts: InStatement[] = [];
  for (const target of TARGETS) {
    const divisions = await fetchChildRegions(target.seedCortarNo);
    for (const dvsn of divisions) {
      let city: string;
      if (target.cityFilter) {
        const matched = cityOfDivision(dvsn.cortarName, target.cityFilter);
        if (!matched) continue;
        city = matched;
      } else {
        city = target.city;
      }
      const dongs = await fetchChildRegions(dvsn.cortarNo);
      for (const dong of dongs) {
        stmts.push({
          sql: `INSERT INTO regions (cortar_no, name, city, division, lat, lng, active)
                VALUES (?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(cortar_no) DO UPDATE SET
                  name=excluded.name, city=excluded.city, division=excluded.division,
                  lat=excluded.lat, lng=excluded.lng`,
          args: [dong.cortarNo, dong.cortarName, city, dvsn.cortarName, dong.centerLat, dong.centerLon],
        });
      }
      console.log(`  ${dvsn.cortarName}: 동 ${dongs.length}개`);
    }
  }
  await db.batch(stmts, "write");
  console.log(`지역 발견 완료: 동 ${stmts.length}개`);
}

interface ArticleRow {
  article_no: string;
  price: number;
}

async function collectComplexArticles(
  db: Client,
  complexNo: string,
  runStartIso: string
): Promise<number> {
  // 기존 활성 매물 가격 (변동 감지용)
  const existing = new Map<string, number>();
  const rs = await db.execute({
    sql: `SELECT article_no, price FROM articles WHERE complex_no = ?`,
    args: [complexNo],
  });
  for (const row of rs.rows as unknown as ArticleRow[]) {
    existing.set(String(row.article_no), Number(row.price));
  }

  const seen = new Set<string>();
  const stmts: InStatement[] = [];
  const now = nowIso();

  for (let page = 1; page <= MAX_ARTICLE_PAGES; page++) {
    const { articleList, isMoreData } = await fetchArticlesPage(complexNo, page);
    for (const a of articleList) {
      if (a.tradeTypeCode !== "A1") continue;
      if (seen.has(a.articleNo)) continue;
      seen.add(a.articleNo);
      const price = parsePriceToManwon(a.dealOrWarrantPrc);
      if (!Number.isFinite(price) || price <= 0) continue;

      const prev = existing.get(a.articleNo);
      if (prev === undefined) {
        stmts.push({
          sql: `INSERT INTO articles (article_no, complex_no, price, area_supply, area_exclusive, area_name,
                  floor_info, direction, building_name, description, tag_list, same_addr_cnt,
                  realtor_name, confirm_ymd, first_seen_at, last_seen_at, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(article_no) DO UPDATE SET
                  price=excluded.price, last_seen_at=excluded.last_seen_at, is_active=1,
                  description=excluded.description, tag_list=excluded.tag_list,
                  same_addr_cnt=excluded.same_addr_cnt, confirm_ymd=excluded.confirm_ymd`,
          args: [
            a.articleNo, complexNo, price, a.area1 ?? null, a.area2 ?? null, a.areaName ?? null,
            a.floorInfo ?? null, a.direction ?? null, a.buildingName ?? null,
            a.articleFeatureDesc ?? null, JSON.stringify(a.tagList ?? []), a.sameAddrCnt ?? 1,
            a.realtorName ?? null, a.articleConfirmYmd ?? null, now, now,
          ],
        });
        stmts.push({
          sql: `INSERT INTO article_price_history (article_no, price, seen_at) VALUES (?, ?, ?)`,
          args: [a.articleNo, price, now],
        });
      } else {
        stmts.push({
          sql: `UPDATE articles SET price=?, last_seen_at=?, is_active=1, description=?,
                  tag_list=?, same_addr_cnt=?, confirm_ymd=?, floor_info=?
                WHERE article_no=?`,
          args: [
            price, now, a.articleFeatureDesc ?? null, JSON.stringify(a.tagList ?? []),
            a.sameAddrCnt ?? 1, a.articleConfirmYmd ?? null, a.floorInfo ?? null, a.articleNo,
          ],
        });
        if (prev !== price) {
          stmts.push({
            sql: `INSERT INTO article_price_history (article_no, price, seen_at) VALUES (?, ?, ?)`,
            args: [a.articleNo, price, now],
          });
        }
      }
    }
    if (!isMoreData) break;
  }

  // 이번 수집에서 안 보인 매물 비활성화 (거래완료/내림 추정)
  stmts.push({
    sql: `UPDATE articles SET is_active=0 WHERE complex_no=? AND is_active=1 AND last_seen_at < ?`,
    args: [complexNo, runStartIso],
  });

  if (stmts.length > 0) await db.batch(stmts, "write");
  return seen.size;
}

/** 호가 기반 집계: complex_area_stats(ask 컬럼) + complex_daily_stats */
async function updateAskStats(db: Client): Promise<void> {
  const now = nowIso();
  const today = kstToday();
  await db.batch(
    [
      {
        sql: `INSERT INTO complex_area_stats (complex_no, area_group, min_ask, avg_ask, ask_count, updated_at)
              SELECT complex_no, CAST(area_exclusive AS INTEGER), MIN(price), CAST(AVG(price) AS INTEGER), COUNT(*), ?
              FROM articles WHERE is_active=1 AND area_exclusive IS NOT NULL
              GROUP BY complex_no, CAST(area_exclusive AS INTEGER)
              ON CONFLICT(complex_no, area_group) DO UPDATE SET
                min_ask=excluded.min_ask, avg_ask=excluded.avg_ask,
                ask_count=excluded.ask_count, updated_at=excluded.updated_at`,
        args: [now],
      },
      // 매물이 모두 사라진 그룹은 호가 집계 초기화
      {
        sql: `UPDATE complex_area_stats SET min_ask=NULL, avg_ask=NULL, ask_count=0, updated_at=?
              WHERE (complex_no, area_group) NOT IN (
                SELECT complex_no, CAST(area_exclusive AS INTEGER) FROM articles
                WHERE is_active=1 AND area_exclusive IS NOT NULL
                GROUP BY complex_no, CAST(area_exclusive AS INTEGER))`,
        args: [now],
      },
      {
        sql: `INSERT INTO complex_daily_stats (complex_no, area_group, date, min_price, avg_price, article_count)
              SELECT complex_no, CAST(area_exclusive AS INTEGER), ?, MIN(price), CAST(AVG(price) AS INTEGER), COUNT(*)
              FROM articles WHERE is_active=1 AND area_exclusive IS NOT NULL
              GROUP BY complex_no, CAST(area_exclusive AS INTEGER)
              ON CONFLICT(complex_no, area_group, date) DO UPDATE SET
                min_price=excluded.min_price, avg_price=excluded.avg_price,
                article_count=excluded.article_count`,
        args: [today],
      },
    ],
    "write"
  );
}

async function main() {
  loadEnv();
  const opts = parseArgs();
  const db = getDb();
  await ensureSchema(db);

  const runStartIso = nowIso();
  const runRs = await db.execute({
    sql: `INSERT INTO collect_runs (kind, started_at, status) VALUES ('naver', ?, 'running') RETURNING id`,
    args: [runStartIso],
  });
  const runId = Number(runRs.rows[0].id);

  try {
    const regionCount = await db.execute(`SELECT COUNT(*) AS c FROM regions`);
    if (Number(regionCount.rows[0].c) === 0 || opts.refreshRegions) {
      await discoverRegions(db);
    }

    const regionsRs = await db.execute({
      sql: opts.city
        ? `SELECT cortar_no, name, city, division FROM regions WHERE active=1 AND city=? ORDER BY cortar_no`
        : `SELECT cortar_no, name, city, division FROM regions WHERE active=1 ORDER BY cortar_no`,
      args: opts.city ? [opts.city] : [],
    });
    const regions = regionsRs.rows as unknown as {
      cortar_no: string; name: string; city: string; division: string;
    }[];
    console.log(`대상 동: ${regions.length}개`);

    let totalComplexes = 0;
    let totalArticles = 0;
    const now = nowIso();

    for (const [i, region] of regions.entries()) {
      const complexes = await fetchComplexes(String(region.cortar_no));
      const stmts: InStatement[] = complexes.map((c) => ({
        sql: `INSERT INTO complexes (complex_no, name, cortar_no, lat, lng, total_households,
                total_buildings, use_approve_ymd, deal_count, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(complex_no) DO UPDATE SET
                name=excluded.name, cortar_no=excluded.cortar_no, lat=excluded.lat, lng=excluded.lng,
                total_households=excluded.total_households, total_buildings=excluded.total_buildings,
                use_approve_ymd=excluded.use_approve_ymd, deal_count=excluded.deal_count,
                updated_at=excluded.updated_at`,
        args: [
          c.complexNo, c.complexName, c.cortarNo, c.latitude, c.longitude,
          c.totalHouseholdCount ?? null, c.totalBuildingCount ?? null,
          c.useApproveYmd ?? null, c.dealCount ?? 0, now,
        ],
      }));
      if (stmts.length > 0) await db.batch(stmts, "write");

      let withDeals = complexes.filter((c) => (c.dealCount ?? 0) > 0);
      if (opts.maxComplexes) withDeals = withDeals.slice(0, opts.maxComplexes);

      for (const c of withDeals) {
        const n = await collectComplexArticles(db, c.complexNo, runStartIso);
        totalArticles += n;
      }
      // 매물이 0이 된 단지의 잔여 활성 매물 정리
      const zeroDeal = complexes.filter((c) => (c.dealCount ?? 0) === 0);
      if (zeroDeal.length > 0) {
        await db.batch(
          zeroDeal.map((c) => ({
            sql: `UPDATE articles SET is_active=0 WHERE complex_no=? AND is_active=1 AND last_seen_at < ?`,
            args: [c.complexNo, runStartIso],
          })),
          "write"
        );
      }
      totalComplexes += complexes.length;
      console.log(
        `[${i + 1}/${regions.length}] ${region.division} ${region.name}: 단지 ${complexes.length}, 매물있는 단지 ${withDeals.length}, 누적 매물 ${totalArticles}`
      );
    }

    await updateAskStats(db);

    await db.execute({
      sql: `UPDATE collect_runs SET finished_at=?, status='success', detail=? WHERE id=?`,
      args: [nowIso(), JSON.stringify({ regions: regions.length, complexes: totalComplexes, articles: totalArticles }), runId],
    });
    console.log(`완료: 단지 ${totalComplexes}, 활성 매물 ${totalArticles}`);
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
