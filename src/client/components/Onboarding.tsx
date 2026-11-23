import { useState } from "react";
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Link2,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { UI_STRINGS, type UiLang } from "../i18n";

interface OnboardingProps {
  lang: UiLang;
  loading: boolean;
  onStartDemo: () => Promise<void>;
  onStartBookmarklet: () => Promise<void>;
  onConnectUrl: (url: string) => Promise<void>;
}

export function Onboarding({
  lang,
  loading,
  onStartDemo,
  onStartBookmarklet,
  onConnectUrl,
}: OnboardingProps) {
  const t = UI_STRINGS[lang];
  const [urlInput, setUrlInput] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    await onConnectUrl(urlInput.trim());
  };

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="tau-gradient rounded-3xl p-6 sm:p-10 text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10 max-w-3xl space-y-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/12 border border-white/20 text-xs font-semibold text-sky-100">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
            <span>{t.heroBadge}</span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight leading-tight">
            {t.heroTitle}
          </h1>

          <p className="text-sm sm:text-base text-sky-100/90 leading-relaxed max-w-2xl">
            {t.heroDesc}
          </p>

          {/* Live visual preview of how events appear in Apple/Google Calendar */}
          <div className="grid sm:grid-cols-3 gap-2.5 pt-1 text-xs">
            <div className="rounded-xl bg-emerald-500/20 border border-emerald-300/35 px-3 py-2.5">
              <div className="font-semibold text-emerald-200">
                ✅ [מבוא לאלגוריתמים]
              </div>
              <div className="text-white/90 mt-0.5">
                תרגיל בית 1 — Completed
              </div>
              <div className="text-[11px] text-emerald-200/80 mt-1">
                Reminders muted automatically
              </div>
            </div>
            <div className="rounded-xl bg-amber-500/20 border border-amber-300/35 px-3 py-2.5">
              <div className="font-semibold text-amber-200">
                ⬜ [מבני נתונים]
              </div>
              <div className="text-white/90 mt-0.5">
                תרגיל בית 2 — Not Completed
              </div>
              <div className="text-[11px] text-amber-200/80 mt-1">
                24h & 2h reminders active
              </div>
            </div>
            <div className="rounded-xl bg-red-500/20 border border-red-300/35 px-3 py-2.5">
              <div className="font-semibold text-red-200">
                🔴 [אלגברה לינארית]
              </div>
              <div className="text-white/90 mt-0.5">
                תרגיל בית 3 — Overdue
              </div>
              <div className="text-[11px] text-red-200/80 mt-1">
                Flagged red in Google & Apple
              </div>
            </div>
          </div>

          {/* Primary Actions */}
          <div className="grid sm:grid-cols-2 gap-3 pt-2">
            <button
              onClick={onStartBookmarklet}
              disabled={loading}
              className="group text-start p-4 rounded-2xl bg-white text-slate-900 hover:bg-sky-50 shadow-lg transition flex items-center justify-between gap-3 cursor-pointer disabled:opacity-60"
            >
              <div>
                <div className="font-bold text-sm sm:text-base flex items-center gap-2">
                  <Zap className="w-4 h-4 text-sky-600" />
                  <span>{t.connectBookmarkletBtn}</span>
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {t.connectBookmarkletSub}
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-sky-700 shrink-0 group-hover:translate-x-0.5 transition" />
            </button>

            <button
              onClick={onStartDemo}
              disabled={loading}
              className="group text-start p-4 rounded-2xl bg-white/12 hover:bg-white/18 border border-white/25 text-white transition flex items-center justify-between gap-3 cursor-pointer disabled:opacity-60"
            >
              <div>
                <div className="font-bold text-sm sm:text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>{t.tryDemoBtn}</span>
                </div>
                <div className="text-xs text-sky-100/80 mt-1">
                  {t.tryDemoSub}
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-sky-200 shrink-0 group-hover:translate-x-0.5 transition" />
            </button>
          </div>
        </div>
      </section>

      {/* Direct Paste Export URL */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Link2 className="w-4 h-4 text-sky-700" />
            <span>{t.pasteUrlHeading}</span>
          </label>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="url"
              dir="ltr"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder={t.pasteUrlPlaceholder}
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600 text-sm font-mono"
            />
            <button
              type="submit"
              disabled={loading || !urlInput.trim()}
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition disabled:opacity-50 cursor-pointer shrink-0"
            >
              {t.connectUrlBtn}
            </button>
          </div>
        </form>
      </section>

      {/* How it works */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900">{t.howItWorksTitle}</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            {
              icon: ShieldCheck,
              color: "text-sky-700 bg-sky-50 border-sky-200",
              title: t.howStep1Title,
              desc: t.howStep1Desc,
            },
            {
              icon: CheckCircle2,
              color: "text-emerald-700 bg-emerald-50 border-emerald-200",
              title: t.howStep2Title,
              desc: t.howStep2Desc,
            },
            {
              icon: CalendarCheck2,
              color: "text-indigo-700 bg-indigo-50 border-indigo-200",
              title: t.howStep3Title,
              desc: t.howStep3Desc,
            },
          ].map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-2.5"
              >
                <div
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center ${card.color}`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                  {card.title}
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  {card.desc}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
