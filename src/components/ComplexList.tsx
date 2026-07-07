"use client";

import { useState } from "react";
import type { MapComplex } from "@/lib/types";
import { formatManwon } from "@/lib/format";

interface Props {
  complexes: MapComplex[];
  selected: string | null;
  onSelect: (c: MapComplex) => void;
  truncated: boolean;
}

type SortKey = "minPrice" | "urgent";

export default function ComplexList({ complexes, selected, onSelect, truncated }: Props) {
  const [sort, setSort] = useState<SortKey>("minPrice");

  const sorted = [...complexes].sort((a, b) => {
    if (sort === "urgent") {
      if (b.urgentCount !== a.urgentCount) return b.urgentCount - a.urgentCount;
      return (a.minUrgentPrice ?? a.minPrice) - (b.minUrgentPrice ?? b.minPrice);
    }
    return a.minPrice - b.minPrice;
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div className="text-xs text-slate-500">
          화면 내 <b className="text-slate-800">{complexes.length}</b>개 단지
          {truncated && <span className="text-amber-600"> (일부만 표시 — 지도를 확대하세요)</span>}
        </div>
        <div className="flex overflow-hidden rounded border border-slate-300 text-xs">
          <button
            onClick={() => setSort("minPrice")}
            className={`px-2 py-0.5 ${sort === "minPrice" ? "bg-slate-800 text-white" : "text-slate-600"}`}
          >
            최저가순
          </button>
          <button
            onClick={() => setSort("urgent")}
            className={`px-2 py-0.5 ${sort === "urgent" ? "bg-red-600 text-white" : "text-slate-600"}`}
          >
            급매순
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sorted.map((c) => (
          <button
            key={c.complexNo}
            onClick={() => onSelect(c)}
            className={`block w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50 ${
              selected === c.complexNo ? "bg-blue-50" : ""
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium text-slate-800">{c.name}</span>
              <span className="shrink-0 text-sm font-bold text-slate-900">
                {formatManwon(c.minPrice)}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
              <span>매물 {c.articleCount}건</span>
              {c.households != null && <span>{c.households.toLocaleString()}세대</span>}
              {c.urgentCount > 0 && (
                <span className="font-semibold text-red-600">
                  ⚡급매 {c.urgentCount}건{" "}
                  {c.minUrgentPrice != null && formatManwon(c.minUrgentPrice)}
                </span>
              )}
            </div>
          </button>
        ))}
        {sorted.length === 0 && (
          <div className="p-6 text-center text-sm text-slate-400">
            조건에 맞는 매물이 있는 단지가 없습니다
          </div>
        )}
      </div>
    </div>
  );
}
