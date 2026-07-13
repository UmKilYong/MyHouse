/** 만원 단위 금액 → "11.9억" / "9,500" */
export function formatManwon(manwon: number): string {
  if (manwon >= 10000) {
    const eok = manwon / 10000;
    const s = eok >= 100 ? Math.round(eok).toString() : (Math.round(eok * 10) / 10).toString();
    return `${s}억`;
  }
  return manwon.toLocaleString();
}

/** 만원 → "11억 9,000" (상세 표기) */
export function formatManwonLong(manwon: number): string {
  const eok = Math.floor(manwon / 10000);
  const rest = manwon % 10000;
  if (eok === 0) return rest.toLocaleString();
  if (rest === 0) return `${eok}억`;
  return `${eok}억 ${rest.toLocaleString()}`;
}

export function formatPct(pct: number | null | undefined): string {
  if (pct == null) return "–";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct}%`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

/** ISO(UTC) → KST "M월 D일 HH:MM" */
export function formatKstDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  const mo = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mo}월 ${day}일 ${hh}:${mm}`;
}
