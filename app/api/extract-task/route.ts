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

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `الوقت الحالي: ${now}

المستخدم قال: "${transcript}"

استخرج المهمة أو التذكير من الكلام وأعد JSON فقط بهذا الشكل:
{
  "title": "عنوان المهمة",
  "remind_at": "2025-01-01T10:00:00+03:00 أو null إذا لم يُذكر وقت",
  "notes": "ملاحظات إضافية أو null"
}

قواعد:
- title: جملة قصيرة واضحة بالعربي
- remind_at: ISO 8601 مع timezone السعودية (+03:00)، أو null
- إذا قال "بكرة" احسب من تاريخ اليوم
- أعد JSON فقط بدون أي نص آخر`,
    }],
  });

  const text = (message.content[0] as { type: string; text: string }).text.trim();
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON");
    const task = JSON.parse(match[0]) as { title: string; remind_at: string | null; notes: string | null };
    return NextResponse.json({ task });
  } catch {
    return NextResponse.json({ error: "فشل تحليل الرد", raw: text }, { status: 500 });
  }
}
