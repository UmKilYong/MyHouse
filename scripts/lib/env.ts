/** 수집 스크립트용 .env.local 로더 (Next.js 밖에서 실행되므로 직접 로드) */
export function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // 파일이 없으면 무시 (CI에서는 환경변수로 직접 주입)
    }
  }
}
