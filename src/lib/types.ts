export interface MapComplex {
  complexNo: string;
  name: string;
  lat: number;
  lng: number;
  households: number | null;
  useApproveYmd: string | null;
  minPrice: number;
  articleCount: number;
  minUrgentPrice: number | null;
  urgentCount: number;
}

export interface MapDataResponse {
  complexes: MapComplex[];
  truncated: boolean;
}

export interface ArticleItem {
  articleNo: string;
  price: number;
  areaExclusive: number | null;
  areaName: string | null;
  floorInfo: string | null;
  direction: string | null;
  buildingName: string | null;
  description: string | null;
  tags: string[];
  sameAddrCnt: number;
  confirmYmd: string | null;
  firstSeenAt: string;
  isUrgent: boolean;
  isBogeumjari: boolean;
  kbPrice: number | null;
  vsAvgPct: number | null;
  vsTradeAvgPct: number | null;
  priceCutPct: number | null;
}

export interface AreaStat {
  areaGroup: number;
  minAsk: number | null;
  avgAsk: number | null;
  askCount: number;
  kbPrice: number | null;
  recentTradeAvg: number | null;
  recentTradeCount: number;
  peakTradePrice: number | null;
  peakTradeDate: string | null;
  change1d: number | null;
  change7d: number | null;
  change30d: number | null;
  changeFromPeak: number | null;
}

export interface TradeItem {
  dealDate: string;
  price: number;
  floor: number | null;
  areaExclusive: number;
}

export interface ComplexDetailResponse {
  complex: {
    complexNo: string;
    name: string;
    lat: number;
    lng: number;
    households: number | null;
    useApproveYmd: string | null;
    address: string;
  };
  articles: ArticleItem[];
  areaStats: AreaStat[];
  trades: TradeItem[];
}

export interface StatusResponse {
  runs: { kind: string; startedAt: string; finishedAt: string | null; status: string }[];
  cities: { city: string; lat: number; lng: number; complexCount: number }[];
  counts: { articles: number; complexes: number; trades: number };
}

export interface Filters {
  areaMin: number;
  areaMax: number;
  maxPrice: number | null; // 만원
  urgentOnly: boolean;
  bogeumjariOnly: boolean; // 보금자리론 가능 (호가·KB시세 6억 이하)
  minHouseholds: number | null; // 최소 세대수
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}
