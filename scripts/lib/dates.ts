/** KST 기준 YYYY-MM-DD */
export function kstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}
