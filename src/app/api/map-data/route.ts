import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { bogeumjariCondition, kbJoin, statsJoin, urgentCondition } from "@/lib/urgent";

export const dynamic = "force-dynamic";

const MAX_COMPLEXES = 800;

function num(v: string | null, fallback: number): number {
  const n = Number(v);
  return v !== null && Number.isFinite(n) ? n : fallback;
}

/**
 * 지도 뷰포트 내 단지별 요약.
 * ?minLat&maxLat&minLng&maxLng&areaMin&areaMax&maxPrice&urgentOnly=1
 * 핀 가격 = 필터 조건에 맞는 실제 활성 매물의 최저 호가 (갭 없음).
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const minLat = num(p.get("minLat"), -90);
  const maxLat = num(p.get("maxLat"), 90);
  const minLng = num(p.get("minLng"), -180);
  const maxLng = num(p.get("maxLng"), 180);
  const areaMin = num(p.get("areaMin"), 0);
  const areaMax = num(p.get("areaMax"), 100000);
  const maxPrice = num(p.get("maxPrice"), 100000000);
  const urgentOnly = p.get("urgentOnly") === "1";
  const bogeumjariOnly = p.get("bogeumjari") === "1";
  const minHouseholds = num(p.get("minHouseholds"), 0);

  const db = getDb();
  const urgent = urgentCondition("a", "s");
  const rs = await db.execute({
    sql: `SELECT c.complex_no, c.name, c.lat, c.lng, c.total_households, c.use_approve_ymd,
                 MIN(a.price) AS min_price,
                 COUNT(*) AS article_count,
                 MIN(CASE WHEN ${urgent} THEN a.price END) AS min_urgent_price,
                 SUM(CASE WHEN ${urgent} THEN 1 ELSE 0 END) AS urgent_count
          FROM complexes c
          JOIN articles a ON a.complex_no = c.complex_no AND a.is_active = 1
          LEFT JOIN complex_area_stats s ON ${statsJoin("a", "s")}
          LEFT JOIN complex_kb_price kb ON ${kbJoin("a", "kb")}
          WHERE c.lat BETWEEN ? AND ? AND c.lng BETWEEN ? AND ?
            AND a.area_exclusive BETWEEN ? AND ?
            AND a.price <= ?
            AND (? = 0 OR COALESCE(c.total_households, 0) >= ?)
            ${bogeumjariOnly ? `AND ${bogeumjariCondition("a", "kb")}` : ""}
          GROUP BY c.complex_no
          ${urgentOnly ? "HAVING urgent_count > 0" : ""}
          ORDER BY article_count DESC
          LIMIT ${MAX_COMPLEXES}`,
    args: [minLat, maxLat, minLng, maxLng, areaMin, areaMax, maxPrice, minHouseholds, minHouseholds],
  });

  return NextResponse.json({
    complexes: rs.rows.map((r) => ({
      complexNo: String(r.complex_no),
      name: r.name,
      lat: Number(r.lat),
      lng: Number(r.lng),
      households: r.total_households == null ? null : Number(r.total_households),
      useApproveYmd: r.use_approve_ymd,
      minPrice: Number(r.min_price),
      articleCount: Number(r.article_count),
      minUrgentPrice: r.min_urgent_price == null ? null : Number(r.min_urgent_price),
      urgentCount: Number(r.urgent_count),
    })),
    truncated: rs.rows.length >= MAX_COMPLEXES,
  });
}
