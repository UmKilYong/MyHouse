"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PriceMap from "./PriceMap";
import FilterBar from "./FilterBar";
import ComplexList from "./ComplexList";
import ComplexDetail from "./ComplexDetail";
import type { Bounds, Filters, MapComplex, MapDataResponse, StatusResponse } from "@/lib/types";
import { timeAgo } from "@/lib/format";

const DEFAULT_CENTER = { lat: 37.4786, lng: 126.8646 }; // 광명

interface Props {
  ncpKeyId: string | null;
}

export default function MapApp({ ncpKeyId }: Props) {
  const [filters, setFilters] = useState<Filters>({
    areaMin: 0,
    areaMax: 400,
    maxPrice: null,
    urgentOnly: false,
    bogeumjariOnly: false,
    minHouseholds: null,
  });
  // 지도 키가 없으면 전체 영역 bounds로 목록만 동작
  const [bounds, setBounds] = useState<Bounds | null>(() =>
    ncpKeyId ? null : { minLat: 33, maxLat: 39, minLng: 124, maxLng: 132 }
  );
  const [complexes, setComplexes] = useState<MapComplex[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number; key: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  const fetchMapData = useCallback((b: Bounds, f: Filters) => {
    const qs = new URLSearchParams({
      minLat: String(b.minLat),
      maxLat: String(b.maxLat),
      minLng: String(b.minLng),
      maxLng: String(b.maxLng),
      areaMin: String(f.areaMin),
      areaMax: String(f.areaMax),
    });
    if (f.maxPrice != null) qs.set("maxPrice", String(f.maxPrice));
    if (f.urgentOnly) qs.set("urgentOnly", "1");
    if (f.bogeumjariOnly) qs.set("bogeumjari", "1");
    if (f.minHouseholds != null) qs.set("minHouseholds", String(f.minHouseholds));
    fetch(`/api/map-data?${qs}`)
      .then((r) => r.json())
      .then((d: MapDataResponse) => {
        setComplexes(d.complexes);
        setTruncated(d.truncated);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!bounds) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchMapData(bounds, filters), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [bounds, filters, fetchMapData]);

  const handleBoundsChange = useCallback((b: Bounds) => {
    setBounds(b);
  }, []);

  const lastRun = status?.runs.find((r) => r.status === "success");

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2">
        <h1 className="text-sm font-black tracking-tight text-slate-900">
          🏠 급매지도
        </h1>
        <span className="text-[11px] text-slate-400">
          {status &&
            `매물 ${status.counts.articles.toLocaleString()} · 단지 ${status.counts.complexes.toLocaleString()} · 실거래 ${status.counts.trades.toLocaleString()}`}
          {lastRun?.finishedAt && ` · 수집 ${timeAgo(lastRun.finishedAt)}`}
        </span>
        <span className="ml-auto text-[11px] text-slate-400">
          핀 가격 = 실제 매물 최저 호가
        </span>
      </header>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        cities={status?.cities ?? []}
        onCityJump={(lat, lng) => setFlyTo({ lat, lng, zoom: 13, key: Date.now() })}
      />

      <div className="flex min-h-0 flex-1">
        {ncpKeyId ? (
          <div className="relative min-w-0 flex-1">
            <PriceMap
              ncpKeyId={ncpKeyId}
              center={DEFAULT_CENTER}
              complexes={complexes}
              selected={selected}
              onBoundsChange={handleBoundsChange}
              onSelect={setSelected}
              flyTo={flyTo}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-slate-50 p-8 text-center text-sm text-slate-500">
            <div>
              <p className="font-semibold">네이버 지도 키가 설정되지 않았습니다</p>
              <p className="mt-1 text-xs">
                NEXT_PUBLIC_NCP_KEY_ID 환경변수를 설정하면 지도가 표시됩니다.
                <br />
                지금은 오른쪽 목록으로 전체 매물을 볼 수 있습니다.
              </p>
            </div>
          </div>
        )}

        <aside className="w-80 shrink-0 border-l border-slate-200 bg-white">
          <ComplexList
            complexes={complexes}
            selected={selected}
            truncated={truncated}
            onSelect={(c) => {
              setSelected(c.complexNo);
              setFlyTo({ lat: c.lat, lng: c.lng, key: Date.now() });
            }}
          />
        </aside>

        {selected && (
          <aside className="w-[26rem] shrink-0 border-l border-slate-200">
            <ComplexDetail
              complexNo={selected}
              filters={filters}
              onClose={() => setSelected(null)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
