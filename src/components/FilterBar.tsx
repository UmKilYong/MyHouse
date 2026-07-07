"use client";

import type { Filters } from "@/lib/types";

const HOUSEHOLD_PRESETS: { label: string; min: number | null }[] = [
  { label: "전체", min: null },
  { label: "100+", min: 100 },
  { label: "300+", min: 300 },
  { label: "500+", min: 500 },
  { label: "1000+", min: 1000 },
];

const AREA_PRESETS: { label: string; min: number; max: number }[] = [
  { label: "전체", min: 0, max: 400 },
  { label: "~49", min: 0, max: 52 },
  { label: "59", min: 52, max: 66 },
  { label: "74", min: 66, max: 80 },
  { label: "84", min: 80, max: 92 },
  { label: "92+", min: 92, max: 400 },
];

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  cities: { city: string; lat: number; lng: number }[];
  onCityJump: (lat: number, lng: number) => void;
}

export default function FilterBar({ filters, onChange, cities, onCityJump }: Props) {
  const activePreset = AREA_PRESETS.find(
    (p) => p.min === filters.areaMin && p.max === filters.areaMax
  );

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-sm">
      <span className="font-semibold text-slate-600">전용면적</span>
      <div className="flex overflow-hidden rounded-lg border border-slate-300">
        {AREA_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange({ ...filters, areaMin: p.min, areaMax: p.max })}
            className={`px-2.5 py-1 text-xs font-medium ${
              activePreset?.label === p.label
                ? "bg-slate-800 text-white"
                : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {p.label}
            {p.label !== "전체" && <span className="ml-0.5 text-[10px]">㎡</span>}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 text-xs text-slate-500">
        <input
          type="number"
          value={filters.areaMin || ""}
          placeholder="0"
          onChange={(e) => onChange({ ...filters, areaMin: Number(e.target.value) || 0 })}
          className="w-14 rounded border border-slate-300 px-1.5 py-1"
        />
        ~
        <input
          type="number"
          value={filters.areaMax === 400 ? "" : filters.areaMax}
          placeholder="∞"
          onChange={(e) => onChange({ ...filters, areaMax: Number(e.target.value) || 400 })}
          className="w-14 rounded border border-slate-300 px-1.5 py-1"
        />
        ㎡
      </div>

      <span className="ml-2 font-semibold text-slate-600">최대가</span>
      <div className="flex items-center gap-1 text-xs text-slate-500">
        <input
          type="number"
          step="0.5"
          value={filters.maxPrice != null ? filters.maxPrice / 10000 : ""}
          placeholder="제한없음"
          onChange={(e) =>
            onChange({
              ...filters,
              maxPrice: e.target.value === "" ? null : Math.round(Number(e.target.value) * 10000),
            })
          }
          className="w-20 rounded border border-slate-300 px-1.5 py-1"
        />
        억
      </div>

      <span className="ml-2 font-semibold text-slate-600">세대수</span>
      <div className="flex overflow-hidden rounded-lg border border-slate-300">
        {HOUSEHOLD_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange({ ...filters, minHouseholds: p.min })}
            className={`px-2.5 py-1 text-xs font-medium ${
              filters.minHouseholds === p.min
                ? "bg-slate-800 text-white"
                : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label className="ml-2 flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={filters.urgentOnly}
          onChange={(e) => onChange({ ...filters, urgentOnly: e.target.checked })}
          className="h-4 w-4 accent-red-600"
        />
        <span className={`font-semibold ${filters.urgentOnly ? "text-red-600" : "text-slate-600"}`}>
          ⚡급매만
        </span>
      </label>

      {cities.length > 0 && (
        <div className="ml-auto flex items-center gap-1">
          {cities.map((c) => (
            <button
              key={c.city}
              onClick={() => onCityJump(c.lat, c.lng)}
              className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100"
            >
              {c.city.replace(/특별시|광역시/, "")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
