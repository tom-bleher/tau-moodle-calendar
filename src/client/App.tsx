import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Globe,
  Link2,
  RefreshCw,
  Settings,
  Sparkles,
} from "lucide-react";
import {
  createWorkspace,
  fetchWorkspace,
  pushMoodleSync,
  refreshWorkspaceFeed,
} from "./api";
import { CalendarConnect } from "./components/CalendarConnect";
import { Dashboard } from "./components/Dashboard";
import { MoodleConnector } from "./components/MoodleConnector";
import { Onboarding } from "./components/Onboarding";
import { SettingsPanel } from "./components/SettingsPanel";
import { UI_STRINGS, type UiLang } from "./i18n";
import type {
  MoodleSyncPayload,
  WorkspaceDashboardResponse,
} from "../shared/types";

type ActiveTab = "tracker" | "calendar" | "moodle" | "settings";

const STORAGE_KEY_TOKEN = "tau_moodle_cal_dashboard_token";
const STORAGE_KEY_LANG = "tau_moodle_cal_ui_lang";

function extractTokenFromPath(): string | null {
  const m = /^\/w\/([A-Za-z0-9_-]+)/.exec(window.location.pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

function decodeHashSyncPayload(): MoodleSyncPayload | null {
  const hash = window.location.hash;
  if (!hash.startsWith("#sync=")) return null;
  try {
    const b64url = hash.slice(6);
    const pad = (4 - (b64url.length % 4)) % 4;
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as MoodleSyncPayload;
  } catch {
    return null;
  }
}

function extractHighlightedItemUid(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith("#item=")) return null;
  try {
    return decodeURIComponent(hash.slice(6));
  } catch {
    return null;
  }
}

export function App() {
  const [lang, setLang] = useState<UiLang>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_LANG);
    return saved === "he" ? "he" : "en";
  });
  const [token, setToken] = useState<string | null>(() => {
    return extractTokenFromPath() || localStorage.getItem(STORAGE_KEY_TOKEN);
  });
  const [data, setData] = useState<WorkspaceDashboardResponse | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("tracker");
  const [loading, setLoading] = useState<boolean>(Boolean(token));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [highlightUid, setHighlightUid] = useState<string | null>(() =>
    extractHighlightedItemUid()
  );

  const t = UI_STRINGS[lang];

  useEffect(() => {
    document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    localStorage.setItem(STORAGE_KEY_LANG, lang);
  }, [lang]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((curr) => (curr === msg ? null : curr));
    }, 4000);
  }, []);

  const activateWorkspace = useCallback(
    (resp: WorkspaceDashboardResponse, initialTab?: ActiveTab) => {
      const nextToken = resp.workspace.dashboardToken;
      setToken(nextToken);
      setData(resp);
      setError(null);
      localStorage.setItem(STORAGE_KEY_TOKEN, nextToken);
      const targetPath = `/w/${encodeURIComponent(nextToken)}`;
      if (window.location.pathname !== targetPath) {
        window.history.replaceState({}, "", targetPath + window.location.hash);
      }
      if (initialTab) setActiveTab(initialTab);
    },
    []
  );

  // Initial load + handle `#sync=` bookmarklet fallback handoff
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const hashPayload = decodeHashSyncPayload();
        let resp: WorkspaceDashboardResponse;
        if (hashPayload) {
          resp = await pushMoodleSync(token, hashPayload);
          window.history.replaceState({}, "", window.location.pathname);
          if (!cancelled) {
            showToast(
              lang === "he"
                ? `סונכרנו ${resp.stats.totalProblemSets} תרגילי בית ממודל את״א!`
                : `Synced ${resp.stats.totalProblemSets} problem sets from TAU Moodle!`
            );
          }
        } else {
          resp = await fetchWorkspace(token);
        }
        if (!cancelled) {
          activateWorkspace(resp);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("Workspace not found")) {
            localStorage.removeItem(STORAGE_KEY_TOKEN);
            setToken(null);
            setData(null);
            window.history.replaceState({}, "", "/");
          } else {
            setError(msg);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, activateWorkspace, showToast, lang]);

  useEffect(() => {
    const onHash = () => setHighlightUid(extractHighlightedItemUid());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const handleRefresh = async () => {
    if (!token || !data?.workspace.hasMoodleUrl) return;
    setRefreshing(true);
    setError(null);
    try {
      const resp = await refreshWorkspaceFeed(token);
      setData(resp);
      if (resp.refreshResult?.error) {
        setError(resp.refreshResult.error);
      } else {
        showToast(
          lang === "he"
            ? "יומן המודל רוענן בהצלחה!"
            : "Moodle calendar refreshed!"
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh feed");
    } finally {
      setRefreshing(false);
    }
  };

  const handleCopyWorkspaceUrl = async () => {
    if (!data) return;
    const url = `${window.location.origin}/w/${encodeURIComponent(data.workspace.dashboardToken)}`;
    await navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCreateDemo = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await createWorkspace({ mode: "demo" });
      activateWorkspace(resp, "tracker");
      showToast(
        lang === "he"
          ? "נטענה הדגמה מלאה של סמסטר באת״א!"
          : "Loaded live TAU semester demo!"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start demo");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEmptyForBookmarklet = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await createWorkspace({ mode: "empty" });
      activateWorkspace(resp, "moodle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workspace");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWithUrl = async (moodleUrl: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await createWorkspace({ mode: "url", moodleUrl });
      activateWorkspace(resp, "tracker");
      showToast(
        lang === "he"
          ? "קישור מודל חובר בהצלחה!"
          : "Connected TAU Moodle calendar!"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid Moodle URL");
    } finally {
      setLoading(false);
    }
  };

  const handleResetWorkspace = () => {
    localStorage.removeItem(STORAGE_KEY_TOKEN);
    setToken(null);
    setData(null);
    window.history.replaceState({}, "", "/");
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Top Bar */}
      <header className="tau-gradient text-white shadow-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5 text-sky-200" />
            </div>
            <div className="truncate">
              <div className="font-bold text-base sm:text-lg tracking-tight leading-tight truncate">
                {t.appTitle}
              </div>
              <div className="text-[11px] sm:text-xs text-sky-200/85 truncate hidden sm:block">
                {t.appSubtitle}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {data && data.workspace.hasMoodleUrl && (
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/12 hover:bg-white/20 border border-white/15 text-xs sm:text-sm font-medium transition disabled:opacity-60 cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
                />
                <span className="hidden sm:inline">
                  {refreshing ? t.refreshing : t.refreshFeed}
                </span>
              </button>
            )}

            {data && (
              <button
                onClick={handleCopyWorkspaceUrl}
                title={t.copyWorkspaceLink}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-medium transition cursor-pointer"
              >
                {copiedLink ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span className="hidden md:inline">
                  {copiedLink ? t.copied : t.copyWorkspaceLink}
                </span>
              </button>
            )}

            <button
              onClick={() => setLang((l) => (l === "en" ? "he" : "en"))}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-semibold transition cursor-pointer"
              aria-label="Toggle language"
            >
              <Globe className="w-3.5 h-3.5 text-sky-200" />
              <span>{lang === "en" ? "עברית" : "EN"}</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs when workspace is active */}
        {data && (
          <div className="border-t border-white/10 bg-black/15">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center gap-1 overflow-x-auto">
              {(
                [
                  {
                    id: "tracker",
                    label: t.navProblemSets,
                    icon: ClipboardCheck,
                    badge:
                      data.stats.notCompletedCount + data.stats.inProgressCount,
                  },
                  { id: "calendar", label: t.navCalendar, icon: Calendar },
                  { id: "moodle", label: t.navMoodle, icon: Link2 },
                  { id: "settings", label: t.navSettings, icon: Settings },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition whitespace-nowrap cursor-pointer ${
                      active
                        ? "border-sky-300 text-white"
                        : "border-transparent text-sky-100/75 hover:text-white hover:border-white/25"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                    {"badge" in tab && tab.badge > 0 && (
                      <span className="px-1.5 py-0.5 text-[11px] font-bold rounded-full bg-amber-400/20 text-amber-200 border border-amber-300/30">
                        {tab.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Demo Banner */}
      {data?.workspace.isDemo && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-950">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{t.demoBanner}</span>
            </div>
            <button
              onClick={() => setActiveTab("moodle")}
              className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs transition cursor-pointer"
            >
              {t.switchToReal}
            </button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {(error || data?.workspace.lastFeedError) && (
        <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 pt-4">
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              {error || data?.workspace.lastFeedError}
            </div>
            {error && (
              <button
                onClick={() => setError(null)}
                className="text-xs font-semibold text-red-700 hover:underline cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-xl border border-white/10 text-sm font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toast}</span>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {loading && !data ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-500 gap-3">
            <RefreshCw className="w-7 h-7 animate-spin text-sky-700" />
            <p className="text-sm font-medium">Loading workspace...</p>
          </div>
        ) : !data ? (
          <Onboarding
            lang={lang}
            loading={loading}
            onStartDemo={handleCreateDemo}
            onStartBookmarklet={handleCreateEmptyForBookmarklet}
            onConnectUrl={handleCreateWithUrl}
          />
        ) : (
          <>
            {activeTab === "tracker" && (
              <Dashboard
                data={data}
                lang={lang}
                highlightUid={highlightUid}
                onUpdate={setData}
                onToast={showToast}
                onGoToMoodle={() => setActiveTab("moodle")}
                onGoToCalendar={() => setActiveTab("calendar")}
              />
            )}
            {activeTab === "calendar" && (
              <CalendarConnect data={data} lang={lang} onToast={showToast} />
            )}
            {activeTab === "moodle" && (
              <MoodleConnector
                data={data}
                lang={lang}
                onUpdate={setData}
                onToast={showToast}
                onGoToTracker={() => setActiveTab("tracker")}
              />
            )}
            {activeTab === "settings" && (
              <SettingsPanel
                data={data}
                lang={lang}
                onUpdate={setData}
                onToast={showToast}
                onDeleted={handleResetWorkspace}
              />
            )}
          </>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white/70 py-4 text-center text-xs text-slate-500">
        <div className="max-w-6xl mx-auto px-4 flex flex-wrap items-center justify-between gap-2">
          <span>
            TAU Moodle Calendar Sync • Privacy-first, zero TAU passwords stored
          </span>
          <span>Apple Calendar (webcal://) & Google Calendar compatible</span>
        </div>
      </footer>
    </div>
  );
}
