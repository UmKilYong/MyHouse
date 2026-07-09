#!/bin/zsh
# 네이버 매물 수집을 로컬(가정용 IP)에서 실행 → Turso.
# 네이버가 GitHub Actions(데이터센터 IP)를 차단하므로 이 스크립트를 launchd로 하루 3회 실행한다.
# 접속 정보는 .env.collect.local(gitignore)에서 읽는다.
set -euo pipefail

# 프로젝트 루트로 이동 (스크립트 위치 기준)
cd "$(dirname "$0")/.."

# node/npm 경로 보장 (launchd는 최소 PATH로 실행)
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

# Turso 접속 정보 로드
set -a
[ -f .env.collect.local ] && source .env.collect.local
set +a

mkdir -p data
LOG=data/launchd-naver.log
echo "===== $(date '+%F %T') 네이버 수집 시작 =====" >> "$LOG"
# 동시 실행 방지 (앞 실행이 안 끝났으면 스킵)
if [ -f data/.naver.lock ] && kill -0 "$(cat data/.naver.lock)" 2>/dev/null; then
  echo "이전 수집이 아직 실행 중 — 이번 실행 스킵" >> "$LOG"
  exit 0
fi
echo $$ > data/.naver.lock

npm run collect:naver >> "$LOG" 2>&1 || echo "수집 비정상 종료 ($?)" >> "$LOG"

rm -f data/.naver.lock
echo "===== $(date '+%F %T') 네이버 수집 종료 =====" >> "$LOG"
