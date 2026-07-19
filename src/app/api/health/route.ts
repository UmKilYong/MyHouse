import { NextResponse } from "next/server";
import { hasD1Config } from "@/db/d1-http";

export const dynamic = "force-dynamic";

/** 진단용: D1 환경변수 존재 여부 + 간단한 D1 읽기 검사 (비밀값은 노출하지 않음) */
export async function GET() {
  const d1 = hasD1Config();
  const info: Record<string, unknown> = {
    d1ConfigPresent: d1,
    hasAccountId: Boolean(process.env.CF_ACCOUNT_ID),
    hasDatabaseId: Boolean(process.env.CF_D1_DATABASE_ID),
    hasApiToken: Boolean(process.env.CF_API_TOKEN),
    onVercel: Boolean(process.env.VERCEL),
  };
  try {
    const { getReadDb } = await import("@/db/client");
    const rs = await getReadDb().execute("SELECT COUNT(*) AS n FROM articles");
    info.articlesCount = Number((rs.rows[0] as { n: unknown }).n);
    info.ok = true;
  } catch (e) {
    info.ok = false;
    info.error = String(e).slice(0, 300);
  }
  return NextResponse.json(info);
}
