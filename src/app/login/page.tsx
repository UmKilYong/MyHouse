"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.replace("/");
    } else {
      const d = await res.json().catch(() => null);
      setError(d?.error ?? "로그인 실패");
    }
  };

  return (
    <div className="flex h-dvh items-center justify-center bg-slate-50">
      <form onSubmit={submit} className="w-72 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-center text-lg font-black text-slate-900">🏠 급매지도</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          autoFocus
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <button
          type="submit"
          className="mt-3 w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          들어가기
        </button>
      </form>
    </div>
  );
}
