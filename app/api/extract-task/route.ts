import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getUserIdFromRequest } from "../../../lib/auth";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { transcript } = (await req.json()) as { transcript: string };
  if (!transcript?.trim()) return NextResponse.json({ error: "النص فارغ" }, { status: 400 });

  const now = new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
  const today = new Date().toISOString().slice(0, 10);

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: `الوقت الحالي: ${now} (تاريخ اليوم: ${today})

المستخدم قال: "${transcript}"

استخرج كل المهام والتذكيرات من الكلام وأعد JSON فقط بهذا الشكل:
{
  "tasks": [
    {
      "title": "عنوان المهمة",
      "remind_at": "2026-04-15T10:00:00+03:00 أو null",
      "notes": "ملاحظات أو null"
    }
  ]
}

قواعد:
- استخرج كل مهمة ذُكرت حتى لو كانت عدة مهام
- title: جملة قصيرة واضحة بالعربي
- remind_at: ISO 8601 بتوقيت السعودية (+03:00)، أو null إذا لم يُذكر وقت
- "اليوم" = ${today}، "بكرا" = اليوم التالي، "العصر" = 16:00، "الظهر" = 12:00، "الصبح" = 09:00
- أعد JSON فقط بدون أي نص آخر`,
    }],
  });

  const text = (message.content[0] as { type: string; text: string }).text.trim();
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON");
    const parsed = JSON.parse(match[0]) as { tasks: { title: string; remind_at: string | null; notes: string | null }[] };
    return NextResponse.json({ tasks: parsed.tasks });
  } catch {
    return NextResponse.json({ error: "فشل تحليل الرد", raw: text }, { status: 500 });
  }
}
