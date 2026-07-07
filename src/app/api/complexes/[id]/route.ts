import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { statsJoin, urgentCondition } from "@/lib/urgent";

export const dynamic = "force-dynamic";

function num(v: string | null, fallback: number): number {
  const n = Number(v);
  return v !== null && Number.isFinite(n) ? n : fallback;
}

/** 오늘 기준 n일 전 이하 중 가장 최근 스냅샷을 찾는다 */
function pickSnapshot(
  rows: { date: string; min_price: number; avg_price: number }[],
  beforeDate: string
): { min_price: number; avg_price: number } | null {
  const candidates = rows.filter((r) => r.date <= beforeDate);
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

function kstDateNDaysAgo(n: number): string {
  return new Date(Date.now() + 9 * 3600 * 1000 - n * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
}

function pctChange(current: number, past: number | null | undefined): number | null {
  if (!past || past <= 0) return null;
  return Math.round(((current - past) / past) * 1000) / 10;
}

/**
 * 단지 상세: 매물 목록(급매 지표), 평형별 통계(변동율), 최근 실거래.
 * ?areaMin&areaMax
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const p = req.nextUrl.searchParams;
  const areaMin = num(p.get("areaMin"), 0);
  const areaMax = num(p.get("areaMax"), 100000);
  const db = getDb();

  const complexRs = await db.execute({
    sql: `SELECT c.*, r.name AS region_name, r.division, r.city
          FROM complexes c JOIN regions r ON r.cortar_no = c.cortar_no
          WHERE c.complex_no = ?`,
    args: [id],
  });
  if (complexRs.rows.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const c = complexRs.rows[0];

  const urgent = urgentCondition("a", "s");
  const articlesRs = await db.execute({
    sql: `SELECT a.article_no, a.price, a.area_exclusive, a.area_name, a.floor_info, a.direction,
                 a.building_name, a.description, a.tag_list, a.same_addr_cnt, a.confirm_ymd,
                 a.first_seen_at,
                 s.avg_ask, s.ask_count, s.recent_trade_avg, s.recent_trade_count,
                 s.peak_trade_price, s.peak_trade_date,
                 ${urgent} AS is_urgent,
                 (SELECT h.price FROM article_price_history h
                  WHERE h.article_no = a.article_no ORDER BY h.seen_at LIMIT 1) AS initial_price
          FROM articles a
          LEFT JOIN complex_area_stats s ON ${statsJoin("a", "s")}
          WHERE a.complex_no = ? AND a.is_active = 1
            AND a.area_exclusive BETWEEN ? AND ?
          ORDER BY a.price ASC`,
    args: [id, areaMin, areaMax],
  });

  // 평형 그룹별 일별 스냅샷 → 전일/전주/전월 변동율
  const dailyRs = await db.execute({
    sql: `SELECT area_group, date, min_price, avg_price FROM complex_daily_stats
          WHERE complex_no = ? ORDER BY area_group, date`,
    args: [id],
  });
  const dailyByGroup = new Map<number, { date: string; min_price: number; avg_price: number }[]>();
  for (const r of dailyRs.rows) {
    const g = Number(r.area_group);
    if (!dailyByGroup.has(g)) dailyByGroup.set(g, []);
    dailyByGroup.get(g)!.push({
      date: String(r.date),
      min_price: Number(r.min_price),
      avg_price: Number(r.avg_price),
    });
  }

  const statsRs = await db.execute({
    sql: `SELECT * FROM complex_area_stats WHERE complex_no = ? AND ask_count > 0 ORDER BY area_group`,
    args: [id],
  });
  const areaStats = statsRs.rows.map((r) => {
    const g = Number(r.area_group);
    const snaps = dailyByGroup.get(g) ?? [];
    const latest = snaps.length > 0 ? snaps[snaps.length - 1] : null;
    const minAsk = r.min_ask == null ? null : Number(r.min_ask);
    const d1 = pickSnapshot(snaps, kstDateNDaysAgo(1));
    const d7 = pickSnapshot(snaps, kstDateNDaysAgo(7));
    const d30 = pickSnapshot(snaps, kstDateNDaysAgo(30));
    const peak = r.peak_trade_price == null ? null : Number(r.peak_trade_price);
    return {
      areaGroup: g,
      minAsk,
      avgAsk: r.avg_ask == null ? null : Number(r.avg_ask),
      askCount: Number(r.ask_count),
      recentTradeAvg: r.recent_trade_avg == null ? null : Number(r.recent_trade_avg),
      recentTradeCount: Number(r.recent_trade_count),
      peakTradePrice: peak,
      peakTradeDate: r.peak_trade_date,
      // 변동율 (%) — 스냅샷이 쌓여야 값이 생긴다
      change1d: latest && d1 && d1 !== latest ? pctChange(latest.min_price, d1.min_price) : null,
      change7d: latest && d7 && d7 !== latest ? pctChange(latest.min_price, d7.min_price) : null,
      change30d: latest && d30 && d30 !== latest ? pctChange(latest.min_price, d30.min_price) : null,
      changeFromPeak: minAsk != null && peak != null ? pctChange(minAsk, peak) : null,
    };
  });

  const tradesRs = await db.execute({
    sql: `SELECT t.deal_date, t.price, t.floor, t.area_exclusive
          FROM complex_trade_map m
          JOIN trades t ON t.sgg_code = m.sgg_code AND t.umd_name = m.umd_name AND t.apt_name = m.apt_name
          WHERE m.complex_no = ? AND t.canceled = 0
            AND t.area_exclusive BETWEEN ? AND ?
          ORDER BY t.deal_date DESC LIMIT 30`,
    args: [id, areaMin, areaMax],
  });

  return NextResponse.json({
    complex: {
      complexNo: String(c.complex_no),
      name: c.name,
      lat: Number(c.lat),
      lng: Number(c.lng),
      households: c.total_households == null ? null : Number(c.total_households),
      useApproveYmd: c.use_approve_ymd,
      address: `${c.city} ${c.division !== c.city ? c.division + " " : ""}${c.region_name}`,
    },
    articles: articlesRs.rows.map((r) => {
      const price = Number(r.price);
      const avgAsk = r.avg_ask == null ? null : Number(r.avg_ask);
      const tradeAvg = r.recent_trade_avg == null ? null : Number(r.recent_trade_avg);
      const initial = r.initial_price == null ? null : Number(r.initial_price);
      return {
        articleNo: String(r.article_no),
        price,
        areaExclusive: r.area_exclusive == null ? null : Number(r.area_exclusive),
        areaName: r.area_name,
        floorInfo: r.floor_info,
        direction: r.direction,
        buildingName: r.building_name,
        description: r.description,
        tags: r.tag_list ? JSON.parse(String(r.tag_list)) : [],
        sameAddrCnt: Number(r.same_addr_cnt),
        confirmYmd: r.confirm_ymd,
        firstSeenAt: r.first_seen_at,
        isUrgent: Boolean(Number(r.is_urgent)),
        vsAvgPct: pctChange(price, avgAsk),
        vsTradeAvgPct: pctChange(price, tradeAvg),
        priceCutPct: initial != null && initial > price ? pctChange(price, initial) : null,
      };
    }),
    areaStats,
    trades: tradesRs.rows.map((r) => ({
      dealDate: r.deal_date,
      price: Number(r.price),
      floor: r.floor == null ? null : Number(r.floor),
      areaExclusive: Number(r.area_exclusive),
    })),
  });
}
