"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    // Supabase تلقائياً يعالج الـ code من الـ URL ويحفظ الـ session
    supabase.auth.onAuthStateChange((event, session) => {
      if (session || event === "SIGNED_IN") {
        router.replace("/");
      }
    });

    // fallback بعد ثانيتين
    const t = setTimeout(() => router.replace("/"), 2000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0f0f0f]">
      <div className="flex flex-col items-center gap-4">
        <span className="size-10 animate-spin rounded-full border-4 border-violet-500/30 border-t-violet-500" />
        <p className="text-sm text-white/40">جاري تسجيل الدخول...</p>
      </div>
    </main>
  );
}
