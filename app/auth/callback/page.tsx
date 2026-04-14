"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

export default function AuthCallback() {
  const router = useRouter();
  const [status, setStatus] = useState("جاري تسجيل الدخول...");

  useEffect(() => {
    async function handleCallback() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setStatus("فشل تسجيل الدخول، حاول مجدداً");
          setTimeout(() => router.replace("/"), 2000);
          return;
        }
      }

      router.replace("/");
    }

    void handleCallback();
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0f0f0f]">
      <div className="flex flex-col items-center gap-4">
        <span className="size-10 animate-spin rounded-full border-4 border-violet-500/30 border-t-violet-500" />
        <p className="text-sm text-white/40">{status}</p>
      </div>
    </main>
  );
}
