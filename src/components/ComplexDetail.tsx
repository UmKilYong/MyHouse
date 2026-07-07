"use client";

import { useEffect, useState } from "react";
import type { ComplexDetailResponse, Filters } from "@/lib/types";
import { formatManwon, formatManwonLong, formatPct } from "@/lib/format";

interface Props {
  complexNo: string;
  filters: Filters;
  onClose: () => void;
}

function PctCell({ v }: { v: number | null }) {
  const color = v == null ? "text-slate-400" : v < 0 ? "text-blue-600" : v > 0 ? "text-red-600" : "text-slate-500";
  return <span className={color}>{formatPct(v)}</span>;
}

export default function ComplexDetail({ complexNo, filters, onClose }: Props) {
  const [data, setData] = useState<ComplexDetailResponse | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const key = `${complexNo}|${filters.areaMin}|${filters.areaMax}`;
  const loading = loadedKey !== key;

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({
      areaMin: String(filters.areaMin),
      areaMax: String(filters.areaMax),
    });
    fetch(`/api/complexes/${complexNo}?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoadedKey(key);
        }
      })
      .catch(() => !cancelled && setLoadedKey(key));
    return () => {
      cancelled = true;
    };
  }, [key, complexNo, filters.areaMin, filters.areaMax]);

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">{data?.complex.name ?? "…"}</h2>
          <p className="text-xs text-slate-500">
            {data?.complex.address}
            {data?.complex.households != null && ` · ${data.complex.households.toLocaleString()}세대`}
            {data?.complex.useApproveYmd && ` · ${String(data.complex.useApproveYmd).slice(0, 4)}년`}
          </p>
        </div>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100">✕</button>
      </div>

      {loading && <div className="p-6 text-center text-sm text-slate-400">불러오는 중…</div>}

      {!loading && data && (
        <div className="flex-1 overflow-y-auto">
          {/* 평형별 시세 + 변동율 */}
          <div className="px-4 pt-3">
            <h3 className="mb-1.5 text-xs font-bold text-slate-500">평형별 시세 (필터 무관 전체)</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400">
                  <th className="py-1 text-left font-medium">전용</th>
                  <th className="text-right font-medium">최저호가</th>
                  <th className="text-right font-medium">평균</th>
                  <th className="text-right font-medium">실거래(6M)</th>
                  <th className="text-right font-medium">전고점</th>
                  <th className="text-right font-medium">고점대비</th>
                  <th className="text-right font-medium">전일</th>
                  <th className="text-right font-medium">전주</th>
                  <th className="text-right font-medium">전월</th>
                </tr>
              </thead>
              <tbody>
                {data.areaStats.map((s) => (
                  <tr key={s.areaGroup} className="border-b border-slate-100">
                    <td className="py-1.5 font-semibold text-slate-700">{s.areaGroup}㎡</td>
                    <td className="text-right font-bold text-slate-900">
                      {s.minAsk != null ? formatManwon(s.minAsk) : "–"}
                    </td>
                    <td className="text-right text-slate-600">
                      {s.avgAsk != null ? formatManwon(s.avgAsk) : "–"}
                    </td>
                    <td className="text-right text-slate-600">
                      {s.recentTradeAvg != null
                        ? `${formatManwon(s.recentTradeAvg)} (${s.recentTradeCount})`
                        : "–"}
                    </td>
                    <td className="text-right text-slate-600">
                      {s.peakTradePrice != null ? formatManwon(s.peakTradePrice) : "–"}
                    </td>
                    <td className="text-right"><PctCell v={s.changeFromPeak} /></td>
                    <td className="text-right"><PctCell v={s.change1d} /></td>
                    <td className="text-right"><PctCell v={s.change7d} /></td>
                    <td className="text-right"><PctCell v={s.change30d} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.areaStats.every((s) => s.change1d == null && s.change7d == null) && (
              <p className="mt-1 text-[10px] text-slate-400">
                전일/전주/전월 변동율은 수집 데이터가 쌓이면 표시됩니다.
              </p>
            )}
          </div>

          {/* 매물 목록 */}
          <div className="px-4 pt-4">
            <h3 className="mb-1.5 text-xs font-bold text-slate-500">
              매물 {data.articles.length}건 (필터 적용, 낮은 가격순)
            </h3>
            <ul className="space-y-2">
              {data.articles.map((a) => (
                <li key={a.articleNo} className={`rounded-lg border p-2.5 ${a.isUrgent ? "border-red-300 bg-red-50" : "border-slate-200"}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-bold text-slate-900">
                      {formatManwonLong(a.price)}
                    </span>
                    <span className="text-xs text-slate-500">
                      전용 {a.areaExclusive}㎡ · {a.floorInfo}층 · {a.buildingName ?? ""}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {a.isUrgent && (
                      <span className="rounded bg-red-600 px-1.5 py-0.5 font-bold text-white">⚡급매</span>
                    )}
                    {a.vsAvgPct != null && (
                      <span className={`rounded px-1.5 py-0.5 ${a.vsAvgPct < 0 ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                        평균대비 {formatPct(a.vsAvgPct)}
                      </span>
                    )}
                    {a.vsTradeAvgPct != null && (
                      <span className={`rounded px-1.5 py-0.5 ${a.vsTradeAvgPct <= 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        실거래대비 {formatPct(a.vsTradeAvgPct)}
                      </span>
                    )}
                    {a.priceCutPct != null && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                        호가인하 {formatPct(a.priceCutPct)}
                      </span>
                    )}
                    {a.sameAddrCnt > 1 && <span className="text-slate-400">동일매물 {a.sameAddrCnt}</span>}
                  </div>
                  {a.description && (
                    <p className="mt-1 truncate text-xs text-slate-600">{a.description}</p>
                  )}
                </li>
              ))}
              {data.articles.length === 0 && (
                <li className="py-4 text-center text-sm text-slate-400">필터 조건에 맞는 매물 없음</li>
              )}
            </ul>
          </div>

          {/* 최근 실거래 */}
          <div className="px-4 py-4">
            <h3 className="mb-1.5 text-xs font-bold text-slate-500">최근 실거래 (필터 적용)</h3>
            {data.trades.length === 0 ? (
              <p className="text-xs text-slate-400">
                실거래 데이터 없음 (실거래 수집 전이거나 매칭 실패)
              </p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {data.trades.map((t, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-1 text-slate-500">{t.dealDate}</td>
                      <td className="text-right text-slate-600">{t.areaExclusive}㎡</td>
                      <td className="text-right text-slate-600">{t.floor != null ? `${t.floor}층` : ""}</td>
                      <td className="text-right font-semibold text-slate-800">{formatManwonLong(t.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
