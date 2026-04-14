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

function formatRemind(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const todayStr = now.toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh" });
  const dStr = d.toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh" });
  const time = d.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });
  if (todayStr === dStr) return `اليوم ${time}`;
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh" });
  if (tomorrowStr === dStr) return `الغد ${time}`;
  return `${dStr} ${time}`;
}

function getDayLabel(iso: string | null): string {
  if (!iso) return "بدون موعد";
  const d = new Date(iso);
  const now = new Date();
  const todayStr = now.toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh" });
  const dStr = d.toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh" });
  if (todayStr === dStr) return "مهام اليوم";
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh" });
  if (tomorrowStr === dStr) return "مهام الغد";
  return `مهام ${dStr}`;
}

function isUrgent(iso: string | null): boolean {
  if (!iso) return false;
  const diff = new Date(iso).getTime() - Date.now();
  return diff > 0 && diff < 60 * 60 * 1000;
}

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
    setTranscript("");
    setCountdown(RECORD_SECONDS);
    const rec = new (SR as new () => {
      lang: string; continuous: boolean; interimResults: boolean;
      start(): void; stop(): void;
      onresult: ((e: { results: { length: number; [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
      onend: (() => void) | null;
    })();
    rec.lang = "ar-SA";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i]![0]!.transcript;
      setTranscript(t);
    };
    rec.onend = () => stopRecording();
    rec.start();
    recognitionRef.current = rec;
    setRecording(true);
    let left = RECORD_SECONDS;
    timerRef.current = setInterval(() => {
      left -= 1; setCountdown(left);
      if (left <= 0) stopRecording();
    }, 1000);
  }

  function stopRecording() {
    (recognitionRef.current as { stop(): void } | null)?.stop();
    recognitionRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecording(false);
    setCountdown(RECORD_SECONDS);
  }

  useEffect(() => {
    if (!recording && transcript.trim()) void processTranscript(transcript.trim());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  async function processTranscript(text: string) {
    setProcessing(true);
    try {
      const res = await fetch("/api/extract-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      });
      const json = (await res.json()) as { tasks?: ExtractedTask[]; error?: string };
      if (!res.ok || !json.tasks?.length) { alert(json.error ?? "فشل الاستخراج"); return; }
      setExtractedTasks(json.tasks);
      setChecked(new Set(json.tasks.map((_, i) => i)));
    } finally {
      setProcessing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    const toSave = extractedTasks.filter((_, i) => checked.has(i));
    for (const task of toSave) {
      await fetch("/api/save-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: task.title, remind_at: task.remind_at, notes: task.notes, transcript }),
      });
    }
    await loadTasks();
    setExtractedTasks([]);
    setTranscript("");
    setSaving(false);
  }

  async function completeTask(id: string) {
    await fetch(`/api/complete-task?id=${id}`, { method: "PATCH" });
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  async function deleteTask(id: string) {
    await fetch(`/api/delete-task?id=${id}`, { method: "DELETE" });
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  const groupedExtracted = extractedTasks.reduce<Record<string, number[]>>((acc, task, i) => {
    const label = getDayLabel(task.remind_at);
    if (!acc[label]) acc[label] = [];
    acc[label]!.push(i);
    return acc;
  }, {});

  return (
    <main className="flex min-h-screen flex-col bg-[#0f0f0f] font-sans" dir="rtl"
      style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white">جوهر 🧑🏿‍💼</h1>
          <p className="text-xs text-violet-400/80 font-medium">سكرتيرك الشخصي — ما تحتاج أحد غيره</p>
          <p className="text-xs text-white/30 mt-0.5">
            {tasks.length > 0 ? `${tasks.length} مهمة بانتظارك` : "قل مهمتك وجوهر يرتبها لك"}
          </p>
        </div>
      </div>

      {/* زر التسجيل */}
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="relative flex items-center justify-center">
          {recording && (
            <>
              <span className="pulse-ring absolute size-40 rounded-full bg-violet-500/30" />
              <span className="pulse-ring absolute size-52 rounded-full bg-violet-500/15" style={{ animationDelay: "0.4s" }} />
            </>
          )}
          <button type="button" onClick={recording ? stopRecording : startRecording} disabled={processing}
            className={`relative z-10 flex size-32 flex-col items-center justify-center rounded-full text-white shadow-2xl transition-all active:scale-95 disabled:opacity-40 ${
              recording ? "bg-red-500 shadow-red-500/40" : "bg-gradient-to-br from-violet-500 to-purple-700 shadow-violet-500/40"
            }`}>
            {recording ? (
              <><span className="text-3xl">⏹</span><span className="mt-1 text-2xl font-extrabold tabular-nums">{countdown}</span></>
            ) : processing ? (
              <span className="size-8 animate-spin rounded-full border-4 border-white/30 border-t-white" />
            ) : (
              <><span className="text-4xl">🎙️</span><span className="mt-1 text-xs font-semibold opacity-80">اضغط للتسجيل</span></>
            )}
          </button>
        </div>
        {processing && <p className="text-sm font-semibold text-violet-400 animate-pulse">✨ جوهر يحلّل كلامك...</p>}
        {recording && transcript && (
          <div className="mx-6 max-w-sm rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
            <p className="text-xs text-white/40 mb-1">ما قلته:</p>
            <p className="text-sm text-white/80">{transcript}</p>
          </div>
        )}
      </div>

      {/* Checklist Preview */}
      {extractedTasks.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 backdrop-blur-sm" onClick={() => setExtractedTasks([])}>
          <div className="w-full max-h-[85vh] overflow-y-auto rounded-t-3xl bg-[#1a1a1a] p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
            <h2 className="text-lg font-extrabold text-white mb-4">📋 مهامك جاهزة</h2>
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
                        className={`w-full flex items-center gap-3 rounded-2xl border px-4 py-3 text-right transition-all ${
                          isChecked ? "border-violet-500/40 bg-violet-500/10" : "border-white/8 bg-white/3 opacity-50"
                        }`}>
                        <span className={`shrink-0 flex size-6 items-center justify-center rounded-full border-2 transition-colors ${
                          isChecked ? "border-violet-500 bg-violet-500" : "border-white/30"
                        }`}>
                          {isChecked && <span className="text-white text-xs font-bold">✓</span>}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-white">{task.title}</p>
                          {task.remind_at && <p className="text-xs text-violet-400 mt-0.5">⏰ {formatRemind(task.remind_at)}</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setExtractedTasks([])}
                className="flex-1 rounded-2xl border border-white/15 py-3 text-sm font-bold text-white/60">إلغاء</button>
              <button type="button" onClick={() => void handleSave()} disabled={saving || checked.size === 0}
                className="flex-[2] rounded-2xl bg-violet-600 py-3 text-base font-bold text-white disabled:opacity-40">
                {saving ? "⏳ جاري الحفظ..." : `حفظ ${checked.size} مهمة ✓`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* قائمة المهام */}
      <div className="flex-1 px-4 pb-8 space-y-3">
        {loading ? (
          <div className="flex justify-center pt-8">
            <span className="size-8 animate-spin rounded-full border-4 border-violet-500/30 border-t-violet-500" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-3 pt-8 text-center">
            <span className="text-5xl opacity-20">🧑🏿‍💼</span>
            <p className="text-sm text-white/30">اضغط زر التسجيل وقل مهمتك</p>
          </div>
        ) : (
          tasks.map(task => (
            <div key={task.id} className={`flex items-start gap-3 rounded-2xl border px-4 py-4 transition-all ${
              isUrgent(task.remind_at) ? "border-amber-500/30 bg-amber-500/8" : "border-white/8 bg-white/5"
            }`}>
              <button type="button" onClick={() => void completeTask(task.id)}
                className="mt-0.5 shrink-0 flex size-6 items-center justify-center rounded-full border-2 border-violet-500/60 hover:bg-violet-500/20 transition-colors" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white leading-snug">{task.title}</p>
                {task.remind_at && (
                  <p className={`mt-1 text-xs font-semibold ${isUrgent(task.remind_at) ? "text-amber-400" : "text-violet-400"}`}>
                    ⏰ {formatRemind(task.remind_at)}
                  </p>
                )}
                {task.notes && <p className="mt-1 text-xs text-white/40 truncate">{task.notes}</p>}
              </div>
              <button type="button" onClick={() => void deleteTask(task.id)}
                className="shrink-0 text-white/20 hover:text-red-400 transition-colors text-lg leading-none">×</button>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
