/**
 * KB부동산(kbland.kr) 비공식 API 클라이언트 (개인 용도 전제).
 *
 * 필수 조건 (2026-07 검증):
 *  - `WebService: 1` 헤더 (없으면 400)
 *  - 파라미터 키가 한글 (UTF-8 URL 인코딩)
 * 주요 엔드포인트:
 *  - POST /land-complex/map/map250mBlwInfoList → bbox 내 단지 목록 (단지기본일련번호, 좌표)
 *  - GET  /land-price/price/... /land-complex/complex/mpriByType → 평형별 KB시세 (만원)
 */

const API_BASE = "https://api.kbland.kr";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DELAY_MS = Number(process.env.KB_DELAY_MS || 400);
const MAX_RETRIES = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HEADERS = {
  "User-Agent": UA,
  Referer: "https://kbland.kr/",
  Origin: "https://kbland.kr",
  Accept: "application/json",
  WebService: "1",
};

async function kbFetch<T>(input: string, init?: RequestInit): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await sleep(DELAY_MS + Math.floor(Math.random() * 200));
    try {
      const res = await fetch(input, init);
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 150)}`);
      const json = JSON.parse(text) as {
        dataHeader?: { resultCode?: string };
        dataBody?: { data?: T; resultCode?: number };
      };
      if (json.dataHeader?.resultCode !== "10000") {
        throw new Error(`KB API 오류: ${text.slice(0, 150)}`);
      }
      return (json.dataBody?.data ?? null) as T;
    } catch (e) {
      lastError = e;
      await sleep(3000 * (attempt + 1));
    }
  }
  throw lastError;
}

export interface KbComplex {
  단지기본일련번호: number;
  단지명: string;
  wgs84위도: number;
  wgs84경도: number;
  물건종류: string;
}

/** bbox 내 KB 아파트 단지 목록 */
export async function fetchKbComplexesInBbox(
  startLat: number,
  endLat: number,
  startLng: number,
  endLng: number
): Promise<KbComplex[]> {
  const body = {
    selectCode: "1,2,3",
    zoomLevel: "17",
    startLat: String(startLat),
    startLng: String(startLng),
    endLat: String(endLat),
    endLng: String(endLng),
    물건종류: "01", // 아파트
    거래유형: "",
    매매시작값: "", 매매종료값: "",
    보증금시작값: "", 보증금종료값: "",
    월세시작값: "", 월세종료값: "",
    면적시작값: "", 면적종료값: "",
    준공년도시작값: "", 준공년도종료값: "",
    방수: "", 욕실수: "",
    세대수시작값: "", 세대수종료값: "",
    관리비시작값: "", 관리비종료값: "",
    용적률시작값: "", 용적률종료값: "",
    건폐율시작값: "", 건폐율종료값: "",
    전세가율시작값: "", 전세가율종료값: "",
    매매전세차시작값: "", 매매전세차종료값: "",
    월세수익률시작값: "", 월세수익률종료값: "",
    구조: "", 주차: "", 엘리베이터: "", 보안옵션: "", 매물: "", 융자금: "",
    분양단지구분코드: "C01",
    일반분양여부: "1,0",
    분양진행단계코드: "S01,S11,S12",
    옵션: "",
    점포수시작값: "", 점포수종료값: "",
    지상층: "", 지하층: "", 지목: "", 용도지역: "", 추진현황: "",
    단지묶음여부: "N",
    webCheck: "Y",
  };
  const data = await kbFetch<{ 단지리스트?: KbComplex[] }>(
    `${API_BASE}/land-complex/map/map250mBlwInfoList`,
    {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return data?.단지리스트 ?? [];
}

export interface KbTypePrice {
  단지기본일련번호: number;
  전용면적: string;
  매매일반거래가: number | null; // 만원
  매매상한가: number | null;
  매매하한가: number | null;
  세대수: number | null;
  시세제공여부: string;
}

/** 단지의 평형(타입)별 KB시세 */
export async function fetchKbTypePrices(kbSerial: number): Promise<KbTypePrice[]> {
  const qs = new URLSearchParams({
    단지기본일련번호: String(kbSerial),
    매물종별구분: "01",
  });
  const data = await kbFetch<KbTypePrice[]>(
    `${API_BASE}/land-complex/complex/mpriByType?${qs}`,
    { headers: HEADERS }
  );
  return Array.isArray(data) ? data : [];
}
