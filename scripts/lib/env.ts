/** 수집·동기화 스크립트용 env 로더 (Next.js 밖에서 실행되므로 직접 로드) */
export function loadEnv(): void {
  // .env.collect.local: 로컬 수집/D1 동기화 전용 (CF_*, TURSO_* 등)
  for (const file of [".env.collect.local", ".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // 파일이 없으면 무시 (CI에서는 환경변수로 직접 주입)
    }
  }
}
