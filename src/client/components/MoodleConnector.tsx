import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Code2,
  Copy,
  ExternalLink,
  Link2,
  Puzzle,
  Zap,
} from "lucide-react";
import {
  buildBookmarkletHref,
  buildMoodleSyncSource,
} from "../../shared/moodle-sync-script";
import type { WorkspaceDashboardResponse } from "../../shared/types";
import { updateMoodleUrl } from "../api";
import { UI_STRINGS, type UiLang } from "../i18n";

interface MoodleConnectorProps {
  data: WorkspaceDashboardResponse;
  lang: UiLang;
  onUpdate: (next: WorkspaceDashboardResponse) => void;
  onToast: (msg: string) => void;
  onGoToTracker: () => void;
}

export function MoodleConnector({
  data,
  lang,
  onUpdate,
  onToast,
  onGoToTracker,
}: MoodleConnectorProps) {
  const t = UI_STRINGS[lang];
  const [urlInput, setUrlInput] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const bookmarkletRef = useRef<HTMLAnchorElement | null>(null);

  const origin = window.location.origin;
  const token = data.workspace.dashboardToken;

  const bookmarkletHref = useMemo(
    () => buildBookmarkletHref(origin, token),
    [origin, token]
  );
  const readableSource = useMemo(
    () => buildMoodleSyncSource(origin, token),
    [origin, token]
  );

  // Set javascript: href imperatively to keep React 19 strictly warning-free
  useEffect(() => {
    if (bookmarkletRef.current) {
      bookmarkletRef.current.setAttribute("href", bookmarkletHref);
    }
  }, [bookmarkletHref]);

  const handleSaveUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setSavingUrl(true);
    setUrlError(null);
    try {
      const resp = await updateMoodleUrl(token, urlInput.trim());
      onUpdate(resp);
      setUrlInput("");
      onToast(
        lang === "he"
          ? "קישור מודל נשמר וסונכרן!"
          : "TAU Moodle export URL saved and synced!"
      );
      onGoToTracker();
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : "Failed to connect URL");
    } finally {
      setSavingUrl(false);
    }
  };

  const copy = async (val: string, label: string) => {
    await navigator.clipboard.writeText(val);
    onToast(`${label} — ${t.copied}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900">
          {t.moodleHeading}
        </h2>
        <p className="text-sm text-slate-600 mt-1">{t.moodleSubheading}</p>
      </div>

      {/* Sync status strip */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm">
        <div className="flex items-center gap-2.5">
          <CheckCircle2
            className={`w-5 h-5 ${
              data.workspace.hasMoodleUrl && !data.workspace.isDemo
                ? "text-emerald-600"
                : "text-slate-300"
            }`}
          />
          <div>
            <div className="font-semibold text-slate-900">
              {data.workspace.isDemo
                ? "Currently in Demo Mode"
                : data.workspace.hasMoodleUrl
                  ? `Connected to ${data.workspace.moodleBaseUrl || "moodle.tau.ac.il"}`
                  : "Not connected to TAU Moodle yet"}
            </div>
            <div className="text-xs text-slate-500">
              {t.lastSynced}:{" "}
              {data.workspace.lastMoodleSyncAt
                ? new Date(data.workspace.lastMoodleSyncAt).toLocaleString()
                : t.neverSynced}
            </div>
          </div>
        </div>
        <a
          href="https://moodle.tau.ac.il/2026/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-800"
        >
          <span>Open TAU Moodle</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Method 1: Bookmarklet */}
      <section className="bg-white rounded-2xl border-2 border-sky-200 p-6 shadow-sm space-y-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-900 text-[11px] font-bold">
            <Zap className="w-3 h-3" />
            <span>Recommended • Zero Install • Pulls Submission Status</span>
          </div>
          <h3 className="text-lg font-bold text-slate-900">
            {t.bookmarkletTitle}
          </h3>
          <p className="text-sm text-slate-600">{t.bookmarkletDesc}</p>
        </div>

        <div className="rounded-2xl bg-slate-50 border border-dashed border-sky-300 p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <a
              ref={bookmarkletRef}
              onClick={(e) => {
                e.preventDefault();
                onToast(
                  "Drag this button onto your bookmarks bar, then click it while on moodle.tau.ac.il!"
                );
              }}
              draggable
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl tau-gradient text-white font-bold text-sm shadow-md hover:shadow-lg transition cursor-grab active:cursor-grabbing select-none"
            >
              <span>{t.bookmarkletDragLabel}</span>
            </a>
            <span className="text-xs text-slate-500">
              ← Drag to bookmarks bar
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => copy(bookmarkletHref, "Bookmarklet URL")}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy Bookmarklet</span>
            </button>
            <button
              onClick={() => setShowSource((s) => !s)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>{showSource ? "Hide Code" : "Inspect Code"}</span>
            </button>
          </div>
        </div>

        <ol className="text-xs sm:text-sm text-slate-700 space-y-1.5 list-decimal ps-5">
          <li>
            Drag <strong>{t.bookmarkletDragLabel}</strong> to your browser&apos;s
            bookmarks bar (press <code>Cmd+Shift+B</code> on Mac to show it).
          </li>
          <li>
            Log in to{" "}
            <a
              href="https://moodle.tau.ac.il/2026/"
              target="_blank"
              rel="noreferrer"
              className="text-sky-700 underline font-semibold"
            >
              moodle.tau.ac.il
            </a>{" "}
            normally via TAU SSO.
          </li>
          <li>
            Click the bookmark! It automatically imports your iCal URL, full
            Hebrew/English course names, and which problem sets you already
            submitted or got graded on Moodle.
          </li>
        </ol>

        {showSource && (
          <pre
            dir="ltr"
            className="p-3.5 rounded-xl bg-slate-900 text-sky-200 text-[11px] overflow-x-auto max-h-72 font-mono"
          >
            {readableSource}
          </pre>
        )}
      </section>

      {/* Method 2: Chrome / Edge Auto-Sync Extension */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0">
            <Puzzle className="w-5 h-5 text-indigo-700" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base sm:text-lg font-bold text-slate-900">
              {t.extensionTitle}
            </h3>
            <p className="text-xs sm:text-sm text-slate-600">
              {t.extensionDesc}
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1.5">
            <div className="font-semibold text-slate-600">App Server URL</div>
            <div className="flex items-center gap-2">
              <code dir="ltr" className="flex-1 truncate font-mono text-slate-800">
                {origin}
              </code>
              <button
                onClick={() => copy(origin, "App Server URL")}
                className="px-2 py-1 rounded-lg border border-slate-300 bg-white font-semibold cursor-pointer"
              >
                Copy
              </button>
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1.5">
            <div className="font-semibold text-slate-600">Workspace Token</div>
            <div className="flex items-center gap-2">
              <code dir="ltr" className="flex-1 truncate font-mono text-slate-800">
                {token}
              </code>
              <button
                onClick={() => copy(token, "Workspace Token")}
                className="px-2 py-1 rounded-lg border border-slate-300 bg-white font-semibold cursor-pointer"
              >
                Copy
              </button>
            </div>
          </div>
        </div>

        <ol className="text-xs text-slate-600 space-y-1 list-decimal ps-5">
          <li>
            Open <code>chrome://extensions</code> (or <code>edge://extensions</code>)
            and turn on <strong>Developer mode</strong>.
          </li>
          <li>
            Click <strong>Load unpacked</strong> and select the{" "}
            <code>extension/</code> folder inside this project.
          </li>
          <li>
            Open the extension popup, paste the App Server URL &amp; Workspace
            Token above, and it will automatically sync your submission status
            every time you visit or submit on TAU Moodle!
          </li>
        </ol>
      </section>

      {/* Method 3: Manual Paste Export URL */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="space-y-1">
          <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
            <Link2 className="w-4 h-4 text-sky-700" />
            <span>{t.manualUrlTitle}</span>
          </h3>
          <p className="text-xs sm:text-sm text-slate-600">{t.manualUrlDesc}</p>
        </div>

        <form onSubmit={handleSaveUrl} className="space-y-2.5">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              dir="ltr"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder={t.pasteUrlPlaceholder}
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white text-xs sm:text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
            <button
              type="submit"
              disabled={savingUrl || !urlInput.trim()}
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer shrink-0"
            >
              {savingUrl ? t.refreshing : t.connectUrlBtn}
            </button>
          </div>
          {urlError && (
            <p className="text-xs font-medium text-red-600">{urlError}</p>
          )}
        </form>
      </section>
    </div>
  );
}
