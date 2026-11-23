import { useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Link2,
  Plus,
  RotateCcw,
  Search,
  StickyNote,
} from "lucide-react";
import { addManualProblemSet, patchItem } from "../api";
import { UI_STRINGS, type UiLang } from "../i18n";
import type {
  CompletionStatus,
  EnrichedCalendarItem,
  WorkspaceDashboardResponse,
} from "../../shared/types";

interface DashboardProps {
  data: WorkspaceDashboardResponse;
  lang: UiLang;
  highlightUid: string | null;
  onUpdate: (next: WorkspaceDashboardResponse) => void;
  onToast: (msg: string) => void;
  onGoToMoodle: () => void;
  onGoToCalendar: () => void;
}

type StatusFilter =
  | "all"
  | "not_completed"
  | "in_progress"
  | "completed"
  | "overdue"
  | "other";

function formatDueRelative(iso: string, lang: UiLang): {
  dateText: string;
  relText: string;
} {
  const date = new Date(iso);
  const locale = lang === "he" ? "he-IL" : "en-IL";
  const dateText = new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  const diffMs = date.getTime() - Date.now();
  const absHours = Math.round(Math.abs(diffMs) / (1000 * 60 * 60));
  const absDays = Math.round(Math.abs(diffMs) / (1000 * 60 * 60 * 24));

  let relText: string;
  if (diffMs < 0) {
    if (absHours < 24) {
      relText = lang === "he" ? `לפני ${absHours} שעות` : `${absHours}h ago`;
    } else {
      relText = lang === "he" ? `לפני ${absDays} ימים` : `${absDays}d ago`;
    }
  } else {
    if (absHours < 1) {
      relText = lang === "he" ? "עוד פחות משעה" : "Due in <1h";
    } else if (absHours < 24) {
      relText = lang === "he" ? `בעוד ${absHours} שעות` : `In ${absHours}h`;
    } else {
      relText = lang === "he" ? `בעוד ${absDays} ימים` : `In ${absDays}d`;
    }
  }

  return { dateText, relText };
}

export function Dashboard({
  data,
  lang,
  highlightUid,
  onUpdate,
  onToast,
  onGoToMoodle,
  onGoToCalendar,
}: DashboardProps) {
  const t = UI_STRINGS[lang];
  const token = data.workspace.dashboardToken;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [editingNoteUid, setEditingNoteUid] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);

  // Add manual problem set form state
  const [newTitle, setNewTitle] = useState("");
  const [newCourse, setNewCourse] = useState("");
  const [newDue, setNewDue] = useState(() => {
    const d = new Date(Date.now() + 3 * 86400 * 1000);
    d.setHours(23, 59, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59`;
  });
  const [newStatus, setNewStatus] = useState<CompletionStatus>("not_completed");
  const [addingManual, setAddingManual] = useState(false);

  const visibleItems = useMemo(
    () => data.items.filter((i) => i.courseVisible),
    [data.items]
  );

  // Per-course completion summary
  const courseStats = useMemo(() => {
    const map = new Map<
      string,
      { name: string; total: number; done: number }
    >();
    for (const c of data.courses) {
      if (!c.visible) continue;
      map.set(c.courseKey, {
        name: c.customName || c.fullname || c.shortname,
        total: 0,
        done: 0,
      });
    }
    for (const item of visibleItems) {
      if (!item.isProblemSet || !item.courseKey) continue;
      const entry = map.get(item.courseKey) ?? {
        name: item.courseDisplayName || item.courseKey,
        total: 0,
        done: 0,
      };
      entry.total++;
      if (item.effectiveStatus === "completed") entry.done++;
      map.set(item.courseKey, entry);
    }
    return Array.from(map.entries());
  }, [data.courses, visibleItems]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleItems.filter((item) => {
      if (statusFilter === "other") {
        if (item.isProblemSet) return false;
      } else {
        if (!item.isProblemSet) return false;
        if (
          statusFilter === "completed" &&
          item.effectiveStatus !== "completed"
        )
          return false;
        if (
          statusFilter === "in_progress" &&
          item.effectiveStatus !== "in_progress"
        )
          return false;
        if (
          statusFilter === "not_completed" &&
          item.effectiveStatus === "completed"
        )
          return false;
        if (statusFilter === "overdue" && !item.isOverdue) return false;
      }

      if (courseFilter !== "all" && item.courseKey !== courseFilter) {
        return false;
      }

      if (q) {
        const hay =
          `${item.summary} ${item.courseDisplayName} ${item.courseKey ?? ""} ${item.note ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [visibleItems, statusFilter, courseFilter, search]);

  const handleSetStatus = async (
    item: EnrichedCalendarItem,
    nextStatus: CompletionStatus | null
  ) => {
    setBusyUid(item.uid);
    try {
      const resp = await patchItem(token, item.uid, {
        manualStatus: nextStatus,
      });
      onUpdate(resp);
      if (nextStatus === "completed") {
        onToast(
          lang === "he"
            ? "סומן כהושלם! היומן עודכן ל-✅"
            : "Marked Completed! Calendar updated to ✅"
        );
      } else if (nextStatus === "not_completed") {
        onToast(
          lang === "he"
            ? "סומן כלא הושלם (⬜)"
            : "Marked Not Completed (⬜)"
        );
      } else if (nextStatus === "in_progress") {
        onToast(lang === "he" ? "סומן כבתהליך (🟡)" : "Marked In Progress (🟡)");
      } else {
        onToast(
          lang === "he"
            ? "שוחזר לסטטוס מודל האוטומטי"
            : "Restored automatic Moodle status"
        );
      }
    } finally {
      setBusyUid(null);
    }
  };

  const handleToggleProblemSetFlag = async (item: EnrichedCalendarItem) => {
    setBusyUid(item.uid);
    try {
      const resp = await patchItem(token, item.uid, {
        isProblemSetManual: !item.isProblemSet,
      });
      onUpdate(resp);
    } finally {
      setBusyUid(null);
    }
  };

  const handleSaveNote = async (uid: string) => {
    setBusyUid(uid);
    try {
      const resp = await patchItem(token, uid, {
        note: noteDraft.trim() || null,
      });
      onUpdate(resp);
      setEditingNoteUid(null);
    } finally {
      setBusyUid(null);
    }
  };

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDue) return;
    setAddingManual(true);
    try {
      const resp = await addManualProblemSet(token, {
        summary: newTitle.trim(),
        courseKey: newCourse.trim() || null,
        dueIso: new Date(newDue).toISOString(),
        status: newStatus,
      });
      onUpdate(resp);
      setShowAddModal(false);
      setNewTitle("");
      setNewCourse("");
      onToast(
        lang === "he"
          ? "התרגיל נוסף ליומן!"
          : "Custom problem set added to calendar!"
      );
    } finally {
      setAddingManual(false);
    }
  };

  if (data.items.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center space-y-4 shadow-sm">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-sky-50 border border-sky-200 flex items-center justify-center">
          <Link2 className="w-7 h-7 text-sky-700" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">
          {t.emptyWorkspaceTitle}
        </h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          {t.emptyWorkspaceDesc}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            onClick={onGoToMoodle}
            className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition cursor-pointer"
          >
            {t.goToMoodleSetup}
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-semibold transition cursor-pointer"
          >
            + {t.addProblemSet}
          </button>
        </div>
      </div>
    );
  }

  const { stats } = data;
  const pct =
    stats.totalProblemSets > 0
      ? Math.round((stats.completedCount / stats.totalProblemSets) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Top Progress + KPI Strip */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t.semesterProgress}
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                {stats.completedCount} / {stats.totalProblemSets}
              </span>
              <span className="text-sm font-semibold text-emerald-700">
                ({pct}%)
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onGoToCalendar}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-900 text-xs sm:text-sm font-semibold transition cursor-pointer"
            >
              <Calendar className="w-4 h-4 text-sky-700" />
              <span>{t.navCalendar}</span>
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{t.addProblemSet}</span>
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden flex">
          <div
            className="bg-emerald-500 h-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
          {stats.inProgressCount > 0 && stats.totalProblemSets > 0 && (
            <div
              className="bg-amber-400 h-full transition-all duration-300"
              style={{
                width: `${Math.round((stats.inProgressCount / stats.totalProblemSets) * 100)}%`,
              }}
            />
          )}
        </div>

        {/* Clickable KPI Filter Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {(
            [
              {
                key: "completed" as const,
                label: t.statCompleted,
                value: stats.completedCount,
                ring: "border-emerald-200 bg-emerald-50/70 text-emerald-900",
                dot: "bg-emerald-500",
              },
              {
                key: "not_completed" as const,
                label: t.statPending,
                value: stats.notCompletedCount + stats.inProgressCount,
                ring: "border-slate-200 bg-slate-50 text-slate-900",
                dot: "bg-slate-500",
              },
              {
                key: "in_progress" as const,
                label: t.statInProgress,
                value: stats.inProgressCount,
                ring: "border-amber-200 bg-amber-50/70 text-amber-900",
                dot: "bg-amber-500",
              },
              {
                key: "overdue" as const,
                label: t.statOverdue,
                value: stats.overdueCount,
                ring:
                  stats.overdueCount > 0
                    ? "border-red-200 bg-red-50/80 text-red-900"
                    : "border-slate-200 bg-slate-50 text-slate-600",
                dot: stats.overdueCount > 0 ? "bg-red-500" : "bg-slate-300",
              },
            ] as const
          ).map((kpi) => {
            const active = statusFilter === kpi.key;
            return (
              <button
                key={kpi.key}
                onClick={() =>
                  setStatusFilter((curr) => (curr === kpi.key ? "all" : kpi.key))
                }
                className={`text-start rounded-xl border px-3.5 py-2.5 transition cursor-pointer ${kpi.ring} ${
                  active ? "ring-2 ring-sky-600 shadow-sm" : "hover:opacity-90"
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium opacity-80">
                  <span className={`w-2 h-2 rounded-full ${kpi.dot}`} />
                  <span>{kpi.label}</span>
                </div>
                <div className="text-xl font-extrabold mt-0.5">{kpi.value}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Filters Bar */}
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
          {/* Status tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {(
              [
                { id: "all", label: t.filterAll },
                { id: "not_completed", label: t.filterPending },
                { id: "in_progress", label: t.filterInProgress },
                { id: "completed", label: t.filterCompleted },
                { id: "overdue", label: t.filterOverdue },
                {
                  id: "other",
                  label: `${t.filterOther} (${stats.otherEventsCount})`,
                },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
                  statusFilter === f.id
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-full ps-9 pe-3 py-1.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
          </div>
        </div>

        {/* Course Pills */}
        {courseStats.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setCourseFilter("all")}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                courseFilter === "all"
                  ? "bg-sky-700 text-white"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
              }`}
            >
              {t.allCourses}
            </button>
            {courseStats.map(([key, c]) => (
              <button
                key={key}
                onClick={() =>
                  setCourseFilter((curr) => (curr === key ? "all" : key))
                }
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition inline-flex items-center gap-1.5 cursor-pointer ${
                  courseFilter === key
                    ? "bg-sky-700 text-white"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                <span>{c.name}</span>
                {c.total > 0 && (
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                      courseFilter === key
                        ? "bg-white/20 text-white"
                        : c.done === c.total
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {c.done}/{c.total}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Problem Set / Event List */}
      <section className="space-y-2.5">
        {filteredItems.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
            {t.noItemsMatch}
          </div>
        ) : (
          filteredItems.map((item) => {
            const { dateText, relText } = formatDueRelative(
              item.dtend || item.dtstart,
              lang
            );
            const isBusy = busyUid === item.uid;
            const isHighlighted = highlightUid === item.uid;

            let borderTone = "border-slate-200 bg-white";
            if (item.isProblemSet) {
              if (item.effectiveStatus === "completed") {
                borderTone = "border-emerald-200/90 bg-emerald-50/25";
              } else if (item.isOverdue) {
                borderTone = "border-red-200 bg-red-50/30";
              } else if (item.effectiveStatus === "in_progress") {
                borderTone = "border-amber-200 bg-amber-50/25";
              }
            }

            const sourceLabel = (() => {
              if (item.statusSource === "manual") return t.sourceManual;
              if (item.statusSource === "moodle") {
                if (item.moodleStatus === "graded")
                  return item.moodleStatusDetail
                    ? `${t.sourceMoodleGraded} (${item.moodleStatusDetail})`
                    : t.sourceMoodleGraded;
                if (item.moodleStatus === "submitted")
                  return t.sourceMoodleSubmitted;
                if (item.moodleStatus === "draft") return t.sourceMoodleDraft;
                if (item.moodleStatus === "not_submitted")
                  return t.sourceMoodleNotSubmitted;
              }
              return t.sourceDefault;
            })();

            return (
              <article
                key={item.uid}
                className={`rounded-2xl border p-4 shadow-xs transition ${borderTone} ${
                  isHighlighted ? "ring-2 ring-sky-500" : ""
                }`}
              >
                <div className="flex items-start gap-3.5">
                  {/* Primary Checkbox Toggle for Problem Sets */}
                  {item.isProblemSet ? (
                    <button
                      disabled={isBusy}
                      onClick={() =>
                        handleSetStatus(
                          item,
                          item.effectiveStatus === "completed"
                            ? "not_completed"
                            : "completed"
                        )
                      }
                      title={
                        item.effectiveStatus === "completed"
                          ? "Mark Not Completed"
                          : "Mark Completed"
                      }
                      className={`mt-0.5 w-7 h-7 rounded-xl border-2 flex items-center justify-center shrink-0 transition cursor-pointer disabled:opacity-50 ${
                        item.effectiveStatus === "completed"
                          ? "bg-emerald-600 border-emerald-600 text-white shadow-xs"
                          : item.isOverdue
                            ? "border-red-400 bg-white hover:bg-red-50 text-transparent hover:text-red-300"
                            : item.effectiveStatus === "in_progress"
                              ? "border-amber-400 bg-amber-50 text-amber-600"
                              : "border-slate-300 bg-white hover:border-emerald-500 text-transparent hover:text-emerald-300"
                      }`}
                    >
                      {item.effectiveStatus === "completed" ? (
                        <Check className="w-4 h-4 stroke-[3]" />
                      ) : item.effectiveStatus === "in_progress" ? (
                        <Clock className="w-3.5 h-3.5" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                    </button>
                  ) : (
                    <div className="mt-0.5 w-7 h-7 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center shrink-0">
                      <Calendar className="w-3.5 h-3.5 text-sky-700" />
                    </div>
                  )}

                  {/* Body */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {item.courseDisplayName && (
                            <span className="px-2 py-0.5 rounded-md bg-slate-900/6 text-slate-700 text-[11px] font-semibold">
                              {item.courseDisplayName}
                            </span>
                          )}
                          {item.isProblemSet && (
                            <span
                              className={`px-2 py-0.5 rounded-md text-[11px] font-semibold inline-flex items-center gap-1 ${
                                item.effectiveStatus === "completed"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : item.isOverdue
                                    ? "bg-red-100 text-red-800"
                                    : item.effectiveStatus === "in_progress"
                                      ? "bg-amber-100 text-amber-800"
                                      : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {item.effectiveStatus === "completed" ? (
                                <CheckCircle2 className="w-3 h-3" />
                              ) : item.isOverdue ? (
                                <AlertCircle className="w-3 h-3" />
                              ) : (
                                <Circle className="w-2.5 h-2.5" />
                              )}
                              <span>{sourceLabel}</span>
                            </span>
                          )}
                        </div>

                        <h3
                          className={`font-bold text-sm sm:text-base leading-snug ${
                            item.isProblemSet &&
                            item.effectiveStatus === "completed"
                              ? "text-slate-600 line-through decoration-emerald-500/60"
                              : "text-slate-900"
                          }`}
                        >
                          {item.summary}
                        </h3>
                      </div>

                      {/* Due date pill */}
                      <div className="text-end shrink-0">
                        <div
                          className={`text-xs font-bold ${
                            item.isOverdue
                              ? "text-red-700"
                              : item.effectiveStatus === "completed"
                                ? "text-emerald-700"
                                : "text-slate-800"
                          }`}
                        >
                          {dateText}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {relText}
                        </div>
                      </div>
                    </div>

                    {/* Exact Calendar Preview Line */}
                    <div className="rounded-lg bg-slate-900/[0.035] border border-slate-200/70 px-2.5 py-1.5 text-xs flex flex-wrap items-center gap-1.5">
                      <span className="text-slate-500 font-medium">
                        {t.calendarPreviewLabel}
                      </span>
                      <span className="font-semibold text-slate-800 break-words">
                        {item.formattedSummary}
                      </span>
                    </div>

                    {/* Personal Note */}
                    {editingNoteUid === item.uid ? (
                      <div className="flex gap-2 pt-1">
                        <input
                          type="text"
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder="Add a note (shown in calendar description)..."
                          className="flex-1 px-2.5 py-1 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                        />
                        <button
                          onClick={() => handleSaveNote(item.uid)}
                          className="px-3 py-1 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer"
                        >
                          {t.saveNote}
                        </button>
                        <button
                          onClick={() => setEditingNoteUid(null)}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs text-slate-600 cursor-pointer"
                        >
                          {t.cancel}
                        </button>
                      </div>
                    ) : (
                      item.note && (
                        <div className="text-xs text-slate-600 flex items-center gap-1.5">
                          <StickyNote className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>{item.note}</span>
                        </div>
                      )
                    )}

                    {/* Controls row */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      {item.isProblemSet ? (
                        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] font-semibold">
                          {(
                            [
                              {
                                val: "not_completed" as const,
                                label: t.statPending,
                                activeCls: "bg-slate-800 text-white",
                              },
                              {
                                val: "in_progress" as const,
                                label: t.statInProgress,
                                activeCls: "bg-amber-500 text-white",
                              },
                              {
                                val: "completed" as const,
                                label: t.statCompleted,
                                activeCls: "bg-emerald-600 text-white",
                              },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.val}
                              disabled={isBusy}
                              onClick={() => handleSetStatus(item, opt.val)}
                              className={`px-2 py-1 rounded-md transition cursor-pointer ${
                                item.effectiveStatus === opt.val
                                  ? opt.activeCls
                                  : "text-slate-600 hover:bg-slate-100"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div />
                      )}

                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        {item.statusSource === "manual" &&
                          item.moodleStatus !== "unknown" && (
                            <button
                              onClick={() => handleSetStatus(item, null)}
                              className="inline-flex items-center gap-1 hover:text-sky-700 font-medium cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>{t.resetToMoodle}</span>
                            </button>
                          )}

                        <button
                          onClick={() => {
                            setEditingNoteUid(item.uid);
                            setNoteDraft(item.note ?? "");
                          }}
                          className="inline-flex items-center gap-1 hover:text-slate-800 font-medium cursor-pointer"
                        >
                          <StickyNote className="w-3 h-3" />
                          <span>{t.addNote}</span>
                        </button>

                        <button
                          onClick={() => handleToggleProblemSetFlag(item)}
                          className="hover:text-slate-800 font-medium cursor-pointer"
                        >
                          {item.isProblemSet
                            ? t.markAsEvent
                            : t.markAsProblemSet}
                        </button>

                        {item.moodleUrl && (
                          <a
                            href={item.moodleUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 font-semibold"
                          >
                            <span>{t.openInMoodle}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>

      {/* Add Manual Problem Set Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                {t.addModalTitle}
              </h3>
              <p className="text-xs text-slate-500 mt-1">{t.addModalDesc}</p>
            </div>

            <form onSubmit={handleAddManual} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t.fieldTitle}
                </label>
                <input
                  required
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. תרגיל בית 5 / Gradescope HW 4"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t.fieldCourse}
                </label>
                <input
                  type="text"
                  list="tau-courses-datalist"
                  value={newCourse}
                  onChange={(e) => setNewCourse(e.target.value)}
                  placeholder="e.g. מבוא לאלגוריתמים"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
                <datalist id="tau-courses-datalist">
                  {data.courses.map((c) => (
                    <option
                      key={c.courseKey}
                      value={c.customName || c.fullname || c.shortname}
                    />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t.fieldDueDate}
                  </label>
                  <input
                    required
                    type="datetime-local"
                    value={newDue}
                    onChange={(e) => setNewDue(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t.fieldStatus}
                  </label>
                  <select
                    value={newStatus}
                    onChange={(e) =>
                      setNewStatus(e.target.value as CompletionStatus)
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                  >
                    <option value="not_completed">{t.statPending}</option>
                    <option value="in_progress">{t.statInProgress}</option>
                    <option value="completed">{t.statCompleted}</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={addingManual}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {t.create}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
