import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export async function getUserIdFromRequest(req: NextRequest): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  const { data: { user } } = await supabase.auth.getUser(token);
  return user?.id ?? null;
}
