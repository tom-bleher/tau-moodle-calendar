import { useMemo, useState } from "react";
import {
  Bell,
  BellOff,
  Calendar,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { generateGoogleAppsScript } from "../../shared/apps-script";
import { generateIcs, resolveItemReminders } from "../../shared/ics-generator";
import type { WorkspaceDashboardResponse } from "../../shared/types";
import { UI_STRINGS, type UiLang } from "../i18n";

interface CalendarConnectProps {
  data: WorkspaceDashboardResponse;
  lang: UiLang;
  onToast: (msg: string) => void;
}

export function CalendarConnect({
  data,
  lang,
  onToast,
}: CalendarConnectProps) {
  const t = UI_STRINGS[lang];
  const [showScriptCode, setShowScriptCode] = useState(false);
  const [showRawIcs, setShowRawIcs] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);

  const origin = window.location.origin;
  const feedPath = `/feed/${encodeURIComponent(data.workspace.feedToken)}.ics${
    pendingOnly ? "?status=incomplete" : ""
  }`;
  const httpsFeedUrl = `${origin}${feedPath}`;
  const webcalFeedUrl = httpsFeedUrl.replace(/^https?:\/\//i, "webcal://");
  const googleSubscribeUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalFeedUrl)}`;
  const jsonFeedUrl = `${origin}/feed/${encodeURIComponent(data.workspace.feedToken)}.json`;

  const appsScriptCode = useMemo(
    () =>
      generateGoogleAppsScript(
        jsonFeedUrl,
        data.workspace.settings.calendarName
      ),
    [jsonFeedUrl, data.workspace.settings.calendarName]
  );

  const previewIcs = useMemo(
    () =>
      generateIcs(data.items, data.workspace.settings, {
        filterStatus: pendingOnly ? "incomplete" : "all",
      }),
    [data.items, data.workspace.settings, pendingOnly]
  );

  const previewEvents = useMemo(
    () =>
      data.items.filter((item) => {
        if (!item.courseVisible) return false;
        if (
          !item.isProblemSet &&
          !data.workspace.settings.showNonProblemSetsInCalendar
        )
          return false;
        if (
          item.isProblemSet &&
          item.effectiveStatus === "completed" &&
          !data.workspace.settings.showCompletedInCalendar
        )
          return false;
        if (
          pendingOnly &&
          (!item.isProblemSet || item.effectiveStatus === "completed")
        )
          return false;
        return true;
      }),
    [data.items, data.workspace.settings, pendingOnly]
  );

  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    onToast(`${label} — ${t.copied}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900">
            {t.calHeading}
          </h2>
          <p className="text-sm text-slate-600 mt-1">{t.calSubheading}</p>
        </div>

        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 px-3 py-2 rounded-xl cursor-pointer">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(e) => setPendingOnly(e.target.checked)}
            className="rounded text-sky-600"
          />
          <span>{t.pendingOnlyFeed}</span>
        </label>
      </div>

      {/* Apple Calendar Card */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center text-sm">
                
              </span>
              <span>{t.appleTitle}</span>
            </h3>
            <p className="text-sm text-slate-600">{t.appleDesc}</p>
          </div>

          <a
            href={webcalFeedUrl}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-sm transition shrink-0"
          >
            <Calendar className="w-4 h-4" />
            <span>{t.appleBtn}</span>
          </a>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            readOnly
            dir="ltr"
            value={webcalFeedUrl}
            className="flex-1 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono text-slate-700"
          />
          <button
            onClick={() => copyText(webcalFeedUrl, "Apple webcal URL")}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy webcal://</span>
          </button>
          <a
            href={`${httpsFeedUrl}${httpsFeedUrl.includes("?") ? "&" : "?"}download=1`}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-800"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t.downloadIcs}</span>
          </a>
        </div>

        <div className="rounded-xl bg-sky-50 border border-sky-200/80 px-3.5 py-2.5 text-xs text-sky-900">
          {t.appleTip}
        </div>
      </section>

      {/* Google Calendar — Two Options */}
      <div className="grid lg:grid-cols-2 gap-5">
        {/* Option A: Instant Color-Coded Apps Script */}
        <section className="bg-white rounded-2xl border-2 border-emerald-200 p-6 shadow-sm space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">
              <Sparkles className="w-3 h-3" />
              <span>Every 15 min • Color-Coded</span>
            </div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900">
              {t.googleFastTitle}
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              {t.googleFastDesc}
            </p>

            {/* Color Legend */}
            <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
              <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
                ● Green: Completed
              </span>
              <span className="px-2 py-0.5 rounded-md bg-orange-100 text-orange-800">
                ● Orange: Pending
              </span>
              <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">
                ● Yellow: In Progress
              </span>
              <span className="px-2 py-0.5 rounded-md bg-red-100 text-red-800">
                ● Red: Overdue
              </span>
            </div>

            <ol className="text-xs text-slate-700 space-y-1.5 list-decimal ps-4 pt-1">
              <li>
                Open{" "}
                <a
                  href="https://script.google.com/home/start"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-700 font-semibold underline"
                >
                  script.google.com
                </a>{" "}
                and click <strong>New project</strong>.
              </li>
              <li>
                Paste the copied script into <code>Code.gs</code> and press Save.
              </li>
              <li>
                Select <code>setupTauMoodleSync</code> and click{" "}
                <strong>Run</strong> (authorize Calendar access once).
              </li>
            </ol>
          </div>

          <div className="space-y-2.5 pt-2">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => copyText(appsScriptCode, "Google Apps Script")}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition cursor-pointer"
              >
                <Copy className="w-4 h-4" />
                <span>{t.copyScriptBtn}</span>
              </button>
              <button
                onClick={() => setShowScriptCode((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                <Code2 className="w-4 h-4" />
                <span>{showScriptCode ? "Hide" : "View"}</span>
              </button>
            </div>

            {showScriptCode && (
              <pre
                dir="ltr"
                className="p-3 rounded-xl bg-slate-900 text-slate-100 text-[11px] overflow-x-auto max-h-64 font-mono"
              >
                {appsScriptCode}
              </pre>
            )}
          </div>
        </section>

        {/* Option B: 1-Click Google URL Subscription */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <h3 className="text-base sm:text-lg font-bold text-slate-900">
              {t.googleUrlTitle}
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              {t.googleUrlDesc}
            </p>
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-600">
                HTTPS .ics Subscription URL
              </div>
              <div className="flex gap-2">
                <input
                  readOnly
                  dir="ltr"
                  value={httpsFeedUrl}
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono text-slate-700"
                />
                <button
                  onClick={() => copyText(httpsFeedUrl, "HTTPS .ics URL")}
                  className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <a
            href={googleSubscribeUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold transition"
          >
            <span>{t.googleUrlBtn}</span>
            <ExternalLink className="w-4 h-4" />
          </a>
        </section>
      </div>

      {/* Live Calendar Preview Table */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-slate-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>
              {t.livePreviewTitle} ({previewEvents.length})
            </span>
          </h3>
          <button
            onClick={() => setShowRawIcs((v) => !v)}
            className="text-xs font-semibold text-sky-700 hover:underline cursor-pointer"
          >
            {showRawIcs ? "Hide Raw .ics" : "Inspect Raw .ics"}
          </button>
        </div>

        {showRawIcs ? (
          <pre
            dir="ltr"
            className="p-3.5 rounded-xl bg-slate-900 text-emerald-200 text-[11px] overflow-x-auto max-h-80 font-mono"
          >
            {previewIcs}
          </pre>
        ) : (
          <div className="divide-y divide-slate-100">
            {previewEvents.slice(0, 12).map((ev) => {
              const reminders = resolveItemReminders(
                ev,
                data.workspace.settings
              );
              return (
                <div
                  key={ev.uid}
                  className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm"
                >
                  <div className="font-semibold text-slate-900">
                    {ev.formattedSummary}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      {reminders.length > 0 ? (
                        <>
                          <Bell className="w-3.5 h-3.5 text-amber-600" />
                          <span>{reminders.length} alert(s)</span>
                        </>
                      ) : (
                        <>
                          <BellOff className="w-3.5 h-3.5 text-slate-400" />
                          <span>Muted</span>
                        </>
                      )}
                    </span>
                    <span dir="ltr" className="font-mono text-[11px]">
                      {new Intl.DateTimeFormat("en-GB", {
                        timeZone: "Asia/Jerusalem",
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(ev.dtend || ev.dtstart))}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
