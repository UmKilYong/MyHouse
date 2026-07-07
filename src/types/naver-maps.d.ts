/* 네이버 지도 JS API v3 — 사용하는 부분만 최소 선언 */
declare namespace naver.maps {
  class LatLng {
    constructor(lat: number, lng: number);
    lat(): number;
    lng(): number;
  }
  class LatLngBounds {
    getSW(): LatLng;
    getNE(): LatLng;
  }
  class Map {
    constructor(el: HTMLElement | string, options?: Record<string, unknown>);
    getBounds(): LatLngBounds;
    getZoom(): number;
    setCenter(latlng: LatLng): void;
    setZoom(zoom: number): void;
    panTo(latlng: LatLng): void;
  }
  class Marker {
    constructor(options: {
      position: LatLng;
      map: Map;
      icon?: { content: string; anchor?: Point };
      zIndex?: number;
    });
    setMap(map: Map | null): void;
    setIcon(icon: { content: string; anchor?: Point }): void;
    setZIndex(z: number): void;
  }
  class Point {
    constructor(x: number, y: number);
  }
  namespace Event {
    function addListener(
      target: object,
      eventName: string,
      handler: (...args: unknown[]) => void
    ): object;
    function clearListeners(target: object, eventName: string): void;
  }
}

interface Window {
  naver?: { maps: typeof naver.maps };
}
