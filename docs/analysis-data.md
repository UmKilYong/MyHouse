# 매물 데이터 접근 가이드 (분석·추천용)

이 프로젝트의 부동산 데이터를 다른 작업(예: 매물 추천 분석)에서 조회하는 방법.

## 어디에 데이터가 있나

- **로컬 SQLite (원본, 전체 데이터)**: `data/house.db` — 수집기가 여기에 쓴다. **분석은 이걸 쓰는 게 좋다** (읽기 한도 없음, 전체 컬럼).
- **Cloudflare D1 (배포 읽기용, 부분집합)**: 웹앱이 REST로 읽는 읽기모델. 분석엔 로컬을 권장.

## 가장 쉬운 조회: `npm run q`

```bash
npm run q "SELECT COUNT(*) FROM articles WHERE is_active=1"
npm run q "SELECT name, total_households FROM complexes LIMIT 5" -- --table
```
결과는 JSON(기본) 또는 표(`-- --table`). 읽기 전용으로만 쓸 것(원본 DB).

Node로 직접 붙어도 된다:
```js
const { createClient } = require('@libsql/client');
const db = createClient({ url: 'file:data/house.db' });
const r = await db.execute("SELECT ...");
```

## 핵심 테이블·컬럼

- `regions(cortar_no, name=동, city=시, division=구, lat, lng, active)`
- `complexes(complex_no, name=단지명, cortar_no, lat, lng, total_households=세대수, use_approve_ymd=준공, kb_serial)`
- `articles(article_no, complex_no, price=호가(만원), area_exclusive=전용면적㎡, floor_info, description, initial_price, is_active)`
  - **활성 매물만**: `WHERE is_active=1`
- `complex_area_stats(complex_no, area_group=전용면적정수, min_ask, avg_ask, ask_count, recent_trade_avg=6개월실거래평균, peak_trade_price=역대실거래최고가, peak_trade_date)`
- `complex_kb_price(complex_no, area_group, kb_price=KB일반거래가(만원))` — 보금자리론 판정용
- `complex_daily_stats(complex_no, area_group, date, min_price, avg_price)` — 전일/전주/전월 변동율 계산
- `trades(sgg_code, umd_name=동, apt_name=단지명, area_exclusive, deal_date, price, floor, canceled)` — 국토부 실거래
- `complex_trade_map(complex_no, sgg_code, umd_name, apt_name)` — 단지↔실거래 매칭

## 자주 쓰는 조인

**보금자리론 가능(호가·KB시세 6억 이하) 매물**:
```sql
SELECT c.name, r.city, r.division, MIN(a.price) min_price, COUNT(*) cnt, c.total_households
FROM articles a
JOIN complexes c ON c.complex_no = a.complex_no
JOIN regions r ON r.cortar_no = c.cortar_no
JOIN complex_kb_price kb ON kb.complex_no = a.complex_no
     AND kb.area_group = CAST(a.area_exclusive AS INTEGER)
WHERE a.is_active = 1 AND a.price <= 60000 AND kb.kb_price <= 60000
  AND r.city = '부천시'
GROUP BY c.complex_no
ORDER BY c.total_households DESC;
```

**단지별 평형 통계(전고점 대비 등)**: `complex_area_stats`를 `complexes`에 조인.

## 참고

- 좌표(lat/lng)로 역·상권까지 거리 계산 가능 (`complexes.lat/lng`).
- 부천 시군구 코드는 옛 구 코드(41192 원미 / 41194 소사 / 41196 오정) — 실거래도 이 코드.
- 급매/보금자리론 판정 로직은 `src/lib/urgent.ts` 참고.
- 현재 로컬 DB 커버리지는 수집 진행 상황에 따라 다르다. 확인: `npm run q "SELECT city, COUNT(DISTINCT complex_no) FROM complexes c JOIN regions r ON r.cortar_no=c.cortar_no GROUP BY city" -- --table`
