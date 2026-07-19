import { NextResponse } from "next/server";
import { getReadDb } from "@/db/client";

export const dynamic = "force-dynamic";

/** 수집 상태 + 지역(시) 목록 — 헤더 표시와 지역 이동 메뉴용 */
export async function GET() {
  const db = getReadDb();
  const runsRs = await db.execute(
    `SELECT kind, started_at, finished_at, status, detail FROM collect_runs ORDER BY id DESC LIMIT 6`
  );
  const citiesRs = await db.execute(
    `SELECT r.city, AVG(c.lat) AS lat, AVG(c.lng) AS lng, COUNT(DISTINCT c.complex_no) AS complex_count
     FROM regions r JOIN complexes c ON c.cortar_no = r.cortar_no
     WHERE r.active = 1 GROUP BY r.city ORDER BY r.city`
  );
  const countsRs = await db.execute(
    `SELECT (SELECT COUNT(*) FROM articles WHERE is_active=1) AS articles,
            (SELECT COUNT(*) FROM complexes) AS complexes,
            (SELECT COUNT(*) FROM trades) AS trades`
  );
  // 매물(네이버) 수집이 마지막으로 성공한 완료 시각 — 화면 표기용
  const listingRs = await db.execute(
    `SELECT MAX(finished_at) AS at FROM collect_runs WHERE kind='naver' AND status='success'`
  );

  return NextResponse.json({
    lastListingCollectedAt: listingRs.rows[0].at ?? null,
    runs: runsRs.rows.map((r) => ({
      kind: r.kind,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status,
    })),
    cities: citiesRs.rows.map((r) => ({
      city: r.city,
      lat: Number(r.lat),
      lng: Number(r.lng),
      complexCount: Number(r.complex_count),
    })),
    counts: {
      articles: Number(countsRs.rows[0].articles),
      complexes: Number(countsRs.rows[0].complexes),
      trades: Number(countsRs.rows[0].trades),
    },
  });
}
