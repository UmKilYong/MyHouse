/** 1인용 간단 인증: APP_PASSWORD 해시를 쿠키로 사용 (미들웨어는 edge라 crypto.subtle 사용) */
export const AUTH_COOKIE = "house_auth";

export async function authToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`house-salt-v1:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
