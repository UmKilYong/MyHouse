/**
 * 네이버 부동산 비공식 API 클라이언트 (개인 용도 전제).
 *
 * new.land.naver.com/api/* 는 다음 조합이 없으면 TOO_MANY_REQUESTS를 반환한다:
 *  - 페이지 HTML에서 추출한 Bearer 토큰 (약 3시간 유효)
 *  - 랜딩 페이지에서 받은 쿠키
 *  - 실제 Chrome과 동일한 sec-* 헤더 세트
 * 요청 간 딜레이 + 429/401 시 백오프·토큰 재발급으로 차단을 회피한다.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const LANDING_URL = "https://new.land.naver.com/complexes?ms=37.5,127.0,15&a=APT&e=RETAIL";
const API_BASE = "https://new.land.naver.com/api";

const REQUEST_DELAY_MS = Number(process.env.NAVER_DELAY_MS || 600);
const MAX_RETRIES = 5;

export interface NaverRegion {
  cortarNo: string;
  cortarName: string;
  cortarType: string; // city | dvsn | sec
  centerLat: number;
  centerLon: number;
}

export interface NaverComplex {
  complexNo: string;
  complexName: string;
  cortarNo: string;
  latitude: number;
  longitude: number;
  totalHouseholdCount: number;
  totalBuildingCount: number;
  useApproveYmd?: string;
  dealCount: number;
  cortarAddress?: string;
}

export interface NaverArticle {
  articleNo: string;
  tradeTypeCode: string;
  dealOrWarrantPrc: string; // "11억 9,000"
  area1?: number; // 공급면적 ㎡
  area2?: number; // 전용면적 ㎡
  areaName?: string;
  floorInfo?: string;
  direction?: string;
  buildingName?: string;
  articleFeatureDesc?: string;
  tagList?: string[];
  sameAddrCnt?: number;
  realtorName?: string;
  articleConfirmYmd?: string;
  priceChangeState?: string;
}

interface Session {
  token: string;
  cookie: string;
  fetchedAt: number;
}

let session: Session | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function createSession(): Promise<Session> {
  const res = await fetch(LANDING_URL, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
    redirect: "follow",
  });
  const html = await res.text();
  const m = html.match(/"token":"(eyJ[A-Za-z0-9_.-]+)"/);
  if (!m) throw new Error("네이버 부동산 페이지에서 토큰을 찾지 못했습니다 (차단 또는 구조 변경)");
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { token: m[1], cookie, fetchedAt: Date.now() };
}

async function getSession(force = false): Promise<Session> {
  // 토큰 유효기간(~3h)보다 짧게 2시간마다 갱신
  if (force || !session || Date.now() - session.fetchedAt > 2 * 60 * 60 * 1000) {
    session = await createSession();
  }
  return session;
}

export async function naverGet<T>(pathAndQuery: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const s = await getSession(attempt > 1);
    await sleep(REQUEST_DELAY_MS + Math.floor(Math.random() * 300));
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${pathAndQuery}`, {
        headers: {
          authorization: `Bearer ${s.token}`,
          cookie: s.cookie,
          accept: "*/*",
          "accept-language": "ko-KR,ko;q=0.9",
          referer: "https://new.land.naver.com/complexes",
          "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "user-agent": UA,
        },
      });
    } catch (e) {
      lastError = e;
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    if (res.ok) {
      const json = JSON.parse(text) as T & { success?: boolean; code?: string };
      if (json && (json as { success?: boolean }).success === false) {
        lastError = new Error(`API error: ${text.slice(0, 200)}`);
        // TOO_MANY_REQUESTS → 점진 백오프 후 재시도
        await sleep(15000 * (attempt + 1));
        continue;
      }
      return json;
    }
    lastError = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    if (res.status === 401) {
      session = null; // 토큰 만료 → 재발급
      await sleep(3000);
    } else if (res.status === 429) {
      await sleep(30000 * (attempt + 1));
    } else {
      await sleep(3000 * (attempt + 1));
    }
  }
  throw lastError;
}

export async function fetchChildRegions(cortarNo: string): Promise<NaverRegion[]> {
  const json = await naverGet<{ regionList: NaverRegion[] }>(
    `/regions/list?cortarNo=${cortarNo}`
  );
  return json.regionList ?? [];
}

export async function fetchComplexes(cortarNo: string): Promise<NaverComplex[]> {
  const json = await naverGet<{ complexList: NaverComplex[] }>(
    `/regions/complexes?cortarNo=${cortarNo}&realEstateType=APT&order=`
  );
  return json.complexList ?? [];
}

export async function fetchArticlesPage(
  complexNo: string,
  page: number
): Promise<{ articleList: NaverArticle[]; isMoreData: boolean }> {
  const qs = new URLSearchParams({
    realEstateType: "APT",
    tradeType: "A1",
    tag: "::::::::",
    rentPriceMin: "0",
    rentPriceMax: "900000000",
    priceMin: "0",
    priceMax: "900000000",
    areaMin: "0",
    areaMax: "900000000",
    showArticle: "false",
    sameAddressGroup: "true", // 동일 매물 묶음 (중개사 중복 제거)
    priceType: "RETAIL",
    page: String(page),
    complexNo,
    type: "list",
    order: "prc",
  });
  const json = await naverGet<{ articleList: NaverArticle[]; isMoreData: boolean }>(
    `/articles/complex/${complexNo}?${qs}`
  );
  return { articleList: json.articleList ?? [], isMoreData: json.isMoreData ?? false };
}

/** "11억 9,000" / "9,500" / "1억" → 만원 단위 정수 */
export function parsePriceToManwon(text: string): number {
  const s = text.replace(/\s/g, "");
  const eokMatch = s.match(/^(\d+(?:,\d{3})*)억(?:(\d+(?:,\d{3})*))?$/);
  if (eokMatch) {
    const eok = Number(eokMatch[1].replace(/,/g, ""));
    const man = eokMatch[2] ? Number(eokMatch[2].replace(/,/g, "")) : 0;
    return eok * 10000 + man;
  }
  return Number(s.replace(/,/g, ""));
}
