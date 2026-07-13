# 🏠 급매지도

관심 지역(광명·안양·인천·서울·고양) 아파트 매매 매물의 **최저가와 급매**를 지도에서 한눈에 보는 개인용 웹사이트.

기존 부동산 서비스의 불편을 해결한다:

| 불편 | 해결 |
|---|---|
| 단지를 클릭해야 가격이 보임 | 지도 핀에 최저 호가를 바로 표시 |
| 핀 가격과 실제 매물 가격의 갭 | 핀 가격 = DB에 있는 실제 매물의 최저 호가 |
| 전용면적 필터가 불편 | 59/74/84㎡ 프리셋 + 범위 필터가 모든 핀에 즉시 반영 |
| 급매와 평균 매물 구분 불가 | 평균 호가·실거래가 대비 급매 판별, 빨간 핀·배지로 구분 |
| 대출 가능 매물을 골라보기 어려움 | 보금자리론 필터 (실제 매매가 6억 이하 + KB시세 6억 이하) |
| 가격 흐름을 알 수 없음 | 전일/전주/전월 변동율 + 전고점(역대 실거래 최고가) 대비 % |

## 구성 (전부 무료 티어)

- **웹**: Next.js → Vercel Hobby
- **DB**: Turso (libSQL) — 로컬 개발 시 `data/house.db` SQLite 파일
- **수집** (전부 **로컬 Mac의 launchd**로 실행 → Turso 기록. 한국 서비스가 GitHub Actions 데이터센터 IP를 차단·타임아웃시키므로 가정용 IP에서 수집한다):
  - 네이버 매물 호가: KST 08/13/20시 하루 3회 (`com.house.naver-collect`)
  - 국토부 실거래(CSV, 키 불필요): 매일 21시 (`com.house.trades-kb`). 일일 100건 제한은 며칠에 걸쳐 이어받음
  - KB시세(보금자리론 판정용): 토요일 21시 (`com.house.trades-kb`가 요일 판별)
  - GitHub Actions(`.github/workflows/collect.yml`)는 **수동 실행(workflow_dispatch)만** — 평소엔 돌지 않아 실패 알람이 없다.
- **지도**: 네이버 Maps JavaScript API v3 (NCP)

## 급매 판별 기준

동일 단지 + 동일 평형(전용면적 정수 그룹) 기준으로,

- 평균 호가 대비 **5% 이상** 저렴 (해당 평형 매물 3건 이상일 때), **또는**
- **최근 6개월 실거래 평균 이하** 호가

기준은 `URGENT_DISCOUNT` 환경변수로 조정 가능. 매물마다 평균대비/실거래대비/호가인하 지표를 함께 표시한다.

## 로컬 실행

```bash
npm install
cp .env.example .env.local   # 키 입력 (없어도 수집·목록은 동작)
npm run migrate              # 스키마 생성
npm run collect:naver -- --city 광명시   # 첫 수집 (전체는 --city 생략)
npm run dev                  # http://localhost:3000
```

- `NEXT_PUBLIC_NCP_KEY_ID` 없이도 목록/상세는 동작하고, 지도만 안 보인다.
- 로컬 SQLite 사용 시 dev 서버가 떠 있는 상태에서 수집을 돌리면 서버의 DB 연결이 낡아질 수 있다 — 수집 후 dev 서버를 재시작하면 된다 (Turso 사용 시 해당 없음).
- 전일/전주/전월 변동율은 수집이 이틀 이상 쌓이면 표시된다.

### 수집 명령

```bash
npm run collect                    # 네이버 매물 + 실거래 전체
npm run collect:naver -- --city 서울특별시   # 특정 시만
npm run collect:naver -- --refresh-regions   # 동 목록 재발견 (행정구역 개편 시)
npm run collect:trades -- --from 2015        # 실거래 백필 시작 연도 지정
npm run collect:trades -- --sgg 41210        # 특정 시군구만
npm run collect:kb                           # KB시세 (보금자리론 판정용)
npm run collect:kb -- --city 광명시           # 특정 시만
```

## 무료 배포 절차

1. **키 발급 (전부 무료)**
   - [네이버 클라우드 플랫폼](https://www.ncloud.com/product/applicationService/maps) → Maps 이용 신청 → *Web Dynamic Map* Key ID 발급. 콘솔에서 **이용 한도를 무료 구간 이하로 설정**하면 초과 시 호출만 차단되고 과금되지 않는다.
   - [Turso](https://turso.tech) 가입 → DB 생성 → URL과 토큰 확보.
2. **GitHub 저장소** 생성 후 푸시 (public 권장, Actions 무료 무제한).
   - Settings → Secrets and variables → Actions에 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` 등록.
   - GitHub Actions는 실거래·KB시세만 수집한다. 매물(네이버)은 아래 "로컬 Mac launchd"로 별도 구성.
3. **Vercel** 프로젝트 연결 (Hobby 무료). 환경변수 등록:
   - `NEXT_PUBLIC_NCP_KEY_ID`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `APP_PASSWORD`
   - NCP 콘솔의 Web Dynamic Map **서비스 URL에 Vercel 도메인 등록** 필요.
4. 접속 → `APP_PASSWORD`로 로그인.

### 수집 = 로컬 Mac launchd (필수)

한국 서비스가 GitHub Actions 데이터센터 IP를 차단·타임아웃시키므로(네이버 ECONNRESET, 국토부 CONNECT_TIMEOUT) 모든 수집을 가정용 IP(집 Mac)에서 돌린다.

- 접속 정보: `~/.house-collect/.env` (TCC 보호 밖, `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`, chmod 600)
- launchd 잡 2개 (`~/Library/LaunchAgents/`):
  - `com.house.naver-collect` → `~/.house-collect/naver-collect.sh` : 매물, 08/13/20시. 로그 `~/.house-collect/naver.log`
  - `com.house.trades-kb` → `~/.house-collect/trades-kb.sh` : 실거래 매일 21시 + KB시세 토요일. 로그 `~/.house-collect/trades-kb.log`
- 저장소의 래퍼 원본: `scripts/local-collect-naver.sh` (나머지 래퍼는 `~/.house-collect/`에만 있고 git 미추적)

```bash
# 등록 / 재적용
launchctl unload ~/Library/LaunchAgents/com.house.naver-collect.plist 2>/dev/null
launchctl load  ~/Library/LaunchAgents/com.house.naver-collect.plist
launchctl load  ~/Library/LaunchAgents/com.house.trades-kb.plist
launchctl start com.house.naver-collect   # 즉시 1회 실행 (테스트)
launchctl start com.house.trades-kb
launchctl list | grep house               # 등록 확인
tail -f ~/.house-collect/naver.log        # 진행 로그
```

> Mac이 꺼져 있거나 잠자기면 그 시각 실행은 건너뛰고, 다음 예약 시각(또는 깨어난 뒤)에 다시 돈다. 스크립트가 프로젝트(`~/Documents/...`)를 읽으려면 실행 주체에 **파일 및 폴더(또는 전체 디스크) 접근 권한**이 필요할 수 있다.

`.github/workflows/collect.yml`은 수동 실행(workflow_dispatch)만 남아 있어 평소엔 돌지 않는다.

## 데이터 흐름

```
네이버·국토부·KB API ─┐  (로컬 Mac launchd 수집)   ┌─ /api/map-data (핀: 단지별 최저가·급매·보금자리)
                     ├→ Turso ──(Vercel)──→ ├─ /api/complexes/[id] (매물·변동율·실거래·KB시세)
                     ┘                              └─ /api/status
```

핵심 테이블: `articles`(매물, 가격 변동 이력 추적) · `trades`(실거래 전체 이력) · `complex_area_stats`(단지·평형별 집계: 평균 호가, 6개월 실거래 평균, 전고점) · `complex_daily_stats`(일별 스냅샷 → 전일/전주/전월 변동율)

## 주의

네이버 부동산 데이터는 비공식 API로 수집하며 약관 위반 소지가 있다. **개인·가족 용도로만 사용**하고, 재배포·상업적 이용은 하지 않는다.
