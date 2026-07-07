import { NextResponse } from "next/server";

/**
 * "지금 수집" — GitHub Actions workflow_dispatch 트리거.
 * GITHUB_TOKEN(actions:write 권한 fine-grained PAT)과 GITHUB_REPO("owner/repo") 필요.
 */
export async function POST() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN / GITHUB_REPO 환경변수가 설정되지 않았습니다" },
      { status: 501 }
    );
  }
  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/collect.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );
  if (res.status === 204) return NextResponse.json({ ok: true });
  const text = await res.text();
  return NextResponse.json(
    { error: `GitHub API ${res.status}: ${text.slice(0, 200)}` },
    { status: 502 }
  );
}
