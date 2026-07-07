"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import type { Bounds, MapComplex } from "@/lib/types";
import { formatManwon } from "@/lib/format";

interface Props {
  ncpKeyId: string;
  center: { lat: number; lng: number };
  complexes: MapComplex[];
  selected: string | null;
  onBoundsChange: (b: Bounds, zoom: number) => void;
  onSelect: (complexNo: string) => void;
  flyTo: { lat: number; lng: number; zoom?: number; key: number } | null;
}

function pinHtml(c: MapComplex, zoom: number, isSelected: boolean): string {
  const urgent = c.urgentCount > 0;
  const price = formatManwon(urgent && c.minUrgentPrice != null ? c.minUrgentPrice : c.minPrice);
  const showName = zoom >= 15;
  const name = c.name.length > 8 ? c.name.slice(0, 8) + "…" : c.name;
  const bg = urgent ? "#dc2626" : "#1e293b";
  const ring = isSelected ? "box-shadow:0 0 0 3px #3b82f6;" : "box-shadow:0 1px 4px rgba(0,0,0,.35);";
  return `
    <div style="transform:translate(-50%,-100%);cursor:pointer;display:flex;flex-direction:column;align-items:center;">
      <div style="background:${bg};${ring}color:#fff;border-radius:8px;padding:3px 8px;font-size:12px;line-height:1.25;white-space:nowrap;font-family:ui-sans-serif,system-ui;text-align:center;">
        ${showName ? `<div style="font-size:10px;opacity:.85;">${name}</div>` : ""}
        <div style="font-weight:700;">${urgent ? "⚡" : ""}${price}</div>
        ${zoom >= 14 ? `<div style="font-size:10px;opacity:.75;">${c.articleCount}건${urgent ? ` · 급매${c.urgentCount}` : ""}</div>` : ""}
      </div>
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid ${bg};"></div>
    </div>`;
}

export default function PriceMap({
  ncpKeyId,
  center,
  complexes,
  selected,
  onBoundsChange,
  onSelect,
  flyTo,
}: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<naver.maps.Map | null>(null);
  const markersRef = useRef<Map<string, { marker: naver.maps.Marker; html: string }>>(new Map());
  const zoomRef = useRef(15);
  const onBoundsChangeRef = useRef(onBoundsChange);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onBoundsChangeRef.current = onBoundsChange;
    onSelectRef.current = onSelect;
  });

  const initMap = () => {
    if (!window.naver || !mapEl.current || mapRef.current) return;
    const map = new window.naver.maps.Map(mapEl.current, {
      center: new window.naver.maps.LatLng(center.lat, center.lng),
      zoom: 15,
      minZoom: 11,
      mapDataControl: false,
      scaleControl: false,
    });
    mapRef.current = map;
    const emitBounds = () => {
      const b = map.getBounds();
      const sw = b.getSW();
      const ne = b.getNE();
      zoomRef.current = map.getZoom();
      onBoundsChangeRef.current(
        { minLat: sw.lat(), maxLat: ne.lat(), minLng: sw.lng(), maxLng: ne.lng() },
        map.getZoom()
      );
    };
    window.naver.maps.Event.addListener(map, "idle", emitBounds);
    // 초기 bounds는 타일 로드 후에 잡힌다
    setTimeout(emitBounds, 500);
  };

  // 마커 diff 갱신
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.naver) return;
    const zoom = zoomRef.current;
    const markers = markersRef.current;
    const nextKeys = new Set(complexes.map((c) => c.complexNo));

    for (const [key, entry] of markers) {
      if (!nextKeys.has(key)) {
        entry.marker.setMap(null);
        markers.delete(key);
      }
    }
    for (const c of complexes) {
      const html = pinHtml(c, zoom, c.complexNo === selected);
      const zIndex = c.complexNo === selected ? 1000 : c.urgentCount > 0 ? 500 : 100;
      const existing = markers.get(c.complexNo);
      if (existing) {
        if (existing.html !== html) {
          existing.marker.setIcon({ content: html });
          existing.marker.setZIndex(zIndex);
          existing.html = html;
        }
      } else {
        const marker = new window.naver.maps.Marker({
          position: new window.naver.maps.LatLng(c.lat, c.lng),
          map,
          icon: { content: html },
          zIndex,
        });
        window.naver.maps.Event.addListener(marker, "click", () =>
          onSelectRef.current(c.complexNo)
        );
        markers.set(c.complexNo, { marker, html });
      }
    }
  }, [complexes, selected]);

  useEffect(() => {
    if (flyTo && mapRef.current && window.naver) {
      if (flyTo.zoom) mapRef.current.setZoom(flyTo.zoom);
      mapRef.current.panTo(new window.naver.maps.LatLng(flyTo.lat, flyTo.lng));
    }
  }, [flyTo]);

  return (
    <>
      <Script
        src={`https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${ncpKeyId}`}
        strategy="afterInteractive"
        onReady={initMap}
      />
      <div ref={mapEl} className="h-full w-full" />
    </>
  );
}
