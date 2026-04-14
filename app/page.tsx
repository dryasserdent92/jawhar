"use client";

import { useEffect, useRef, useState } from "react";

const RECORD_SECONDS = 15;

type Task = {
  id: string;
  title: string;
  remind_at: string | null;
  notes: string | null;
  completed: boolean;
  created_at: string;
};

type ExtractedTask = { title: string; remind_at: string | null; notes: string | null };

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ar-SA", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh",
  });
}

function isUrgent(iso: string | null): boolean {
  if (!iso) return false;
  const diff = new Date(iso).getTime() - Date.now();
  return diff > 0 && diff < 60 * 60 * 1000;
}

function getGroup(iso: string | null): "today" | "tomorrow" | "week" | "later" | "none" {
  if (!iso) return "none";
  const d = new Date(iso);
  const now = new Date();
  const riyadh = (date: Date) =>
    new Date(date.toLocaleString("en-US", { timeZone: "Asia/Riyadh" }));
  const r = riyadh(now);
  const rd = riyadh(d);
  const diffDays = Math.floor((rd.setHours(0,0,0,0) - new Date(r.getFullYear(), r.getMonth(), r.getDate()).getTime()) / 86400000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays <= 7) return "week";
  return "later";
}

function getDayLabel(iso: string | null): string {
  if (!iso) return "بدون موعد";
  const d = new Date(iso);
  const now = new Date();
  const todayStr = now.toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh" });
  const dStr = d.toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh" });
  if (todayStr === dStr) return "مهام اليوم";
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh" }) === dStr) return "مهام الغد";
  return `مهام ${dStr}`;
}

const GROUPS = [
  { key: "today",    label: "اليوم",       emoji: "☀️",  color: "from-violet-500/20 to-violet-500/5",  border: "border-violet-500/30" },
  { key: "tomorrow", label: "الغد",        emoji: "🌙",  color: "from-blue-500/20 to-blue-500/5",      border: "border-blue-500/30"   },
  { key: "week",     label: "هذا الأسبوع", emoji: "📅",  color: "from-teal-500/20 to-teal-500/5",      border: "border-teal-500/30"   },
  { key: "later",    label: "لاحقاً",      emoji: "🗓",  color: "from-orange-500/20 to-orange-500/5",  border: "border-orange-500/30" },
  { key: "none",     label: "بدون موعد",   emoji: "📌",  color: "from-white/10 to-white/5",            border: "border-white/15"      },
] as const;

export default function HomePage() {
  const [tasks, setTasks]           = useState<Task[]>([]);
  const [loading, setLoading]       = useState(true);
  const [recording, setRecording]   = useState(false);
  const [countdown, setCountdown]   = useState(RECORD_SECONDS);
  const [transcript, setTranscript] = useState("");
  const [processing, setProcessing] = useState(false);
  const [extractedTasks, setExtractedTasks] = useState<ExtractedTask[]>([]);
  const [checked, setChecked]       = useState<Set<number>>(new Set());
  const [saving, setSaving]         = useState(false);

  const recognitionRef = useRef<unknown>(null);
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { void loadTasks(); }, []);

  async function loadTasks() {
    setLoading(true);
    const res = await fetch("/api/tasks");
    const json = (await res.json()) as { tasks?: Task[] };
    setTasks(json.tasks ?? []);
    setLoading(false);
  }

  function startRecording() {
    const SR = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition
            ?? (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR) { alert("متصفحك لا يدعم التسجيل الصوتي، جرب Chrome"); return; }
    setTranscript(""); setCountdown(RECORD_SECONDS);
    const rec = new (SR as new () => {
      lang: string; continuous: boolean; interimResults: boolean;
      start(): void; stop(): void;
      onresult: ((e: { results: { length: number; [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
      onend: (() => void) | null;
    })();
    rec.lang = "ar-SA"; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => { let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i]![0]!.transcript; setTranscript(t); };
    rec.onend = () => stopRecording();
    rec.start(); recognitionRef.current = rec; setRecording(true);
    let left = RECORD_SECONDS;
    timerRef.current = setInterval(() => { left--; setCountdown(left); if (left <= 0) stopRecording(); }, 1000);
  }

  function stopRecording() {
    (recognitionRef.current as { stop(): void } | null)?.stop();
    recognitionRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecording(false); setCountdown(RECORD_SECONDS);
  }

  useEffect(() => {
    if (!recording && transcript.trim()) void processTranscript(transcript.trim());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  async function processTranscript(text: string) {
    setProcessing(true);
    try {
      const res = await fetch("/api/extract-task", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      });
      const json = (await res.json()) as { tasks?: ExtractedTask[]; error?: string };
      if (!res.ok || !json.tasks?.length) { alert(json.error ?? "فشل الاستخراج"); return; }
      setExtractedTasks(json.tasks);
      setChecked(new Set(json.tasks.map((_, i) => i)));
    } finally { setProcessing(false); }
  }

  async function handleSave() {
    setSaving(true);
    for (const task of extractedTasks.filter((_, i) => checked.has(i))) {
      await fetch("/api/save-task", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: task.title, remind_at: task.remind_at, notes: task.notes, transcript }),
      });
    }
    await loadTasks(); setExtractedTasks([]); setTranscript(""); setSaving(false);
  }

  async function completeTask(id: string) {
    await fetch(`/api/complete-task?id=${id}`, { method: "PATCH" });
    setTasks(p => p.filter(t => t.id !== id));
  }

  async function deleteTask(id: string) {
    await fetch(`/api/delete-task?id=${id}`, { method: "DELETE" });
    setTasks(p => p.filter(t => t.id !== id));
  }

  const grouped = GROUPS.reduce<Record<string, Task[]>>((acc, g) => {
    acc[g.key] = tasks.filter(t => getGroup(t.remind_at) === g.key);
    return acc;
  }, {});

  const groupedExtracted = extractedTasks.reduce<Record<string, number[]>>((acc, task, i) => {
    const label = getDayLabel(task.remind_at);
    if (!acc[label]) acc[label] = [];
    acc[label]!.push(i); return acc;
  }, {});

  const today = new Date().toLocaleDateString("ar-SA", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Riyadh" });

  return (
    <main className="min-h-screen bg-[#0a0a0f] font-sans" dir="rtl"
      style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}>

      {/* ── Hero Header ── */}
      <div className="relative overflow-hidden px-5 pt-8 pb-10">
        <div className="absolute inset-0 bg-gradient-to-b from-violet-950/60 to-transparent" />
        <div className="absolute -top-20 -right-20 size-64 rounded-full bg-violet-600/10 blur-3xl" />
        <div className="absolute -top-10 -left-10 size-48 rounded-full bg-purple-600/10 blur-3xl" />
        <div className="relative">
          <p className="text-xs text-violet-400/60 mb-1">{today}</p>
          <h1 className="text-3xl font-black text-white tracking-tight">جوهر 🧑🏿‍💼</h1>
          <p className="text-sm text-violet-300/70 mt-1">سكرتيرك الشخصي — ما تحتاج أحد غيره</p>

          {/* إحصائية سريعة */}
          <div className="mt-5 flex gap-3">
            {[
              { label: "اليوم", count: grouped.today?.length ?? 0, color: "bg-violet-500/20 text-violet-300" },
              { label: "الغد",  count: grouped.tomorrow?.length ?? 0, color: "bg-blue-500/20 text-blue-300" },
              { label: "الكل",  count: tasks.length, color: "bg-white/10 text-white/60" },
            ].map(s => (
              <div key={s.label} className={`rounded-2xl px-4 py-2 ${s.color}`}>
                <p className="text-xl font-black">{s.count}</p>
                <p className="text-xs opacity-80">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── زر التسجيل ── */}
      <div className="flex flex-col items-center gap-4 py-2 pb-8">
        <div className="relative flex items-center justify-center">
          {recording && (
            <>
              <span className="pulse-ring absolute size-44 rounded-full bg-violet-500/20" />
              <span className="pulse-ring absolute size-56 rounded-full bg-violet-500/10" style={{ animationDelay: "0.5s" }} />
            </>
          )}
          <button type="button" onClick={recording ? stopRecording : startRecording} disabled={processing}
            className={`relative z-10 flex size-28 flex-col items-center justify-center rounded-full text-white shadow-2xl transition-all duration-300 active:scale-95 disabled:opacity-40 ${
              recording
                ? "bg-red-500 shadow-red-500/30 scale-110"
                : "bg-gradient-to-br from-violet-500 to-purple-700 shadow-violet-500/30"
            }`}>
            {recording ? (
              <><span className="text-3xl">⏹</span><span className="mt-1 text-xl font-black tabular-nums">{countdown}</span></>
            ) : processing ? (
              <span className="size-7 animate-spin rounded-full border-4 border-white/30 border-t-white" />
            ) : (
              <><span className="text-4xl">🎙️</span><span className="mt-1 text-[10px] font-semibold opacity-70">اضغط للتسجيل</span></>
            )}
          </button>
        </div>

        {processing && (
          <div className="flex items-center gap-2">
            <span className="size-1.5 animate-bounce rounded-full bg-violet-400" style={{ animationDelay: "0ms" }} />
            <span className="size-1.5 animate-bounce rounded-full bg-violet-400" style={{ animationDelay: "150ms" }} />
            <span className="size-1.5 animate-bounce rounded-full bg-violet-400" style={{ animationDelay: "300ms" }} />
            <p className="text-xs font-semibold text-violet-400">جوهر يحلّل كلامك</p>
          </div>
        )}

        {recording && transcript && (
          <div className="mx-5 w-full max-w-sm rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
            <p className="text-[10px] text-white/30 mb-1">ما قلته:</p>
            <p className="text-sm text-white/70 leading-relaxed">{transcript}</p>
          </div>
        )}
      </div>

      {/* ── قائمة المهام مجمّعة ── */}
      <div className="px-4 pb-16 space-y-6">
        {loading ? (
          <div className="flex justify-center pt-4">
            <span className="size-8 animate-spin rounded-full border-4 border-violet-500/30 border-t-violet-500" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-3 pt-4 text-center">
            <span className="text-6xl opacity-10">🧑🏿‍💼</span>
            <p className="text-sm text-white/20">لا توجد مهام — اضغط التسجيل وقل مهمتك</p>
          </div>
        ) : (
          GROUPS.map(g => {
            const list = grouped[g.key] ?? [];
            if (!list.length) return null;
            return (
              <div key={g.key}>
                {/* عنوان المجموعة */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">{g.emoji}</span>
                  <h2 className="text-sm font-bold text-white/70">{g.label}</h2>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/40">{list.length}</span>
                  <div className="flex-1 h-px bg-white/5" />
                </div>

                <div className="space-y-2">
                  {list.map(task => (
                    <div key={task.id}
                      className={`group flex items-start gap-3 rounded-2xl border bg-gradient-to-l px-4 py-3.5 transition-all ${g.color} ${g.border} ${
                        isUrgent(task.remind_at) ? "ring-1 ring-amber-400/40" : ""
                      }`}>
                      {/* زر الإنجاز */}
                      <button type="button" onClick={() => void completeTask(task.id)}
                        className="mt-0.5 shrink-0 flex size-5 items-center justify-center rounded-full border-2 border-white/30 hover:border-violet-400 hover:bg-violet-500/20 transition-all" />

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white leading-snug">{task.title}</p>
                        {task.remind_at && (
                          <p className={`mt-1 text-xs font-medium ${isUrgent(task.remind_at) ? "text-amber-400" : "text-white/40"}`}>
                            {isUrgent(task.remind_at) ? "⚡ " : "⏰ "}{formatTime(task.remind_at)}
                          </p>
                        )}
                        {task.notes && <p className="mt-1 text-xs text-white/30 truncate">{task.notes}</p>}
                      </div>

                      <button type="button" onClick={() => void deleteTask(task.id)}
                        className="shrink-0 opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 transition-all text-xl leading-none">×</button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Checklist Preview ── */}
      {extractedTasks.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/80 backdrop-blur-md" onClick={() => setExtractedTasks([])}>
          <div className="w-full max-h-[88vh] overflow-y-auto rounded-t-3xl bg-[#141420] border-t border-white/10 p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="mx-auto mb-5 h-1 w-12 rounded-full bg-white/20" />
            <h2 className="text-xl font-black text-white mb-1">📋 مهامك جاهزة</h2>
            <p className="text-xs text-white/30 mb-5">اختر المهام اللي تبي تحفظها</p>

            {Object.entries(groupedExtracted).map(([label, indices]) => (
              <div key={label} className="mb-5">
                <p className="text-xs font-bold text-violet-400 mb-2">{label}</p>
                <div className="space-y-2">
                  {indices.map(i => {
                    const task = extractedTasks[i]!;
                    const isChecked = checked.has(i);
                    return (
                      <button key={i} type="button"
                        onClick={() => setChecked(prev => { const n = new Set(prev); isChecked ? n.delete(i) : n.add(i); return n; })}
                        className={`w-full flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-right transition-all ${
                          isChecked ? "border-violet-500/50 bg-violet-500/15" : "border-white/8 bg-white/3 opacity-40"
                        }`}>
                        <span className={`shrink-0 flex size-6 items-center justify-center rounded-full border-2 transition-all ${
                          isChecked ? "border-violet-400 bg-violet-500" : "border-white/20"
                        }`}>
                          {isChecked && <span className="text-white text-[11px] font-black">✓</span>}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-white">{task.title}</p>
                          {task.remind_at && (
                            <p className="text-xs text-violet-400 mt-0.5">
                              ⏰ {new Date(task.remind_at).toLocaleString("ar-SA", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" })}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="flex gap-3 pt-2 sticky bottom-0 pb-2">
              <button type="button" onClick={() => setExtractedTasks([])}
                className="flex-1 rounded-2xl border border-white/10 py-3.5 text-sm font-bold text-white/40">
                إلغاء
              </button>
              <button type="button" onClick={() => void handleSave()} disabled={saving || checked.size === 0}
                className="flex-[2] rounded-2xl bg-gradient-to-l from-violet-600 to-purple-600 py-3.5 text-base font-black text-white disabled:opacity-30 transition-opacity">
                {saving ? "⏳ جاري الحفظ..." : `حفظ ${checked.size} مهمة ✓`}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
