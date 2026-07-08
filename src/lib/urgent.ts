/**
 * 급매 판별 기준 (매물 단위, 동일 단지·평형 그룹 비교):
 *  - 단지·평형 평균 호가 대비 URGENT_DISCOUNT 이상 저렴 (매물 3건 이상일 때만), 또는
 *  - 최근 6개월 실거래 평균 이하 호가
 */
export const URGENT_DISCOUNT = Number(process.env.URGENT_DISCOUNT || 0.95);
export const MIN_ASK_COUNT_FOR_AVG = 3;

/** a = articles alias, s = complex_area_stats alias */
export function urgentCondition(a = "a", s = "s"): string {
  return `(
    (${s}.avg_ask IS NOT NULL AND ${s}.ask_count >= ${MIN_ASK_COUNT_FOR_AVG}
      AND ${a}.price <= ${s}.avg_ask * ${URGENT_DISCOUNT})
    OR (${s}.recent_trade_avg IS NOT NULL AND ${a}.price <= ${s}.recent_trade_avg)
  )`;
}

/** articles ↔ complex_area_stats 조인 조건 (전용면적 정수 절사 그룹) */
export function statsJoin(a = "a", s = "s"): string {
  return `${s}.complex_no = ${a}.complex_no AND ${s}.area_group = CAST(${a}.area_exclusive AS INTEGER)`;
}

/**
 * 보금자리론: 실제 매매가(호가) 6억 이하 AND KB시세 6억 이하.
 * KB시세가 없는 단지·평형은 판정 불가로 제외 (보수적).
 */
export const BOGEUMJARI_LIMIT = Number(process.env.BOGEUMJARI_LIMIT || 60000); // 만원

export function kbJoin(a = "a", kb = "kb"): string {
  return `${kb}.complex_no = ${a}.complex_no AND ${kb}.area_group = CAST(${a}.area_exclusive AS INTEGER)`;
}

export function bogeumjariCondition(a = "a", kb = "kb"): string {
  return `(${a}.price <= ${BOGEUMJARI_LIMIT} AND ${kb}.kb_price IS NOT NULL AND ${kb}.kb_price <= ${BOGEUMJARI_LIMIT})`;
}
