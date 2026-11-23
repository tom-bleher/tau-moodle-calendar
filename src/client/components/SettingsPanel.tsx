import { useMemo, useState } from "react";
import { Eye, EyeOff, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { formatCalendarSummary } from "../../shared/formatting";
import type {
  LabelLang,
  TitleStyle,
  WorkspaceDashboardResponse,
  WorkspaceSettings,
} from "../../shared/types";
import {
  deleteWorkspace,
  patchCourse,
  patchSettings,
  rotateFeedToken,
} from "../api";
import { UI_STRINGS, type UiLang } from "../i18n";

interface SettingsPanelProps {
  data: WorkspaceDashboardResponse;
  lang: UiLang;
  onUpdate: (next: WorkspaceDashboardResponse) => void;
  onToast: (msg: string) => void;
  onDeleted: () => void;
}

const REMINDER_OPTIONS = [
  { mins: 2880, label: "48h before" },
  { mins: 1440, label: "24h before" },
  { mins: 360, label: "6h before" },
  { mins: 120, label: "2h before" },
  { mins: 30, label: "30m before" },
];

export function SettingsPanel({
  data,
  lang,
  onUpdate,
  onToast,
  onDeleted,
}: SettingsPanelProps) {
  const t = UI_STRINGS[lang];
  const token = data.workspace.dashboardToken;
  const settings = data.workspace.settings;

  const [calNameDraft, setCalNameDraft] = useState(settings.calendarName);
  const [courseDrafts, setCourseDrafts] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        data.courses.map((c) => [c.courseKey, c.customName ?? ""])
      )
  );
  const [saving, setSaving] = useState(false);

  const savePatch = async (patch: Partial<WorkspaceSettings>) => {
    setSaving(true);
    try {
      const resp = await patchSettings(token, patch);
      onUpdate(resp);
      onToast(t.saveSettings);
    } finally {
      setSaving(false);
    }
  };

  const toggleReminder = (mins: number) => {
    const exists = settings.reminderMinutes.includes(mins);
    const next = exists
      ? settings.reminderMinutes.filter((m) => m !== mins)
      : [...settings.reminderMinutes, mins].sort((a, b) => b - a);
    void savePatch({ reminderMinutes: next });
  };

  const handleSaveCourseAlias = async (courseKey: string) => {
    const val = (courseDrafts[courseKey] ?? "").trim();
    const resp = await patchCourse(token, courseKey, {
      customName: val || null,
    });
    onUpdate(resp);
    onToast("Course display name updated");
  };

  const handleToggleCourseVisible = async (
    courseKey: string,
    visible: boolean
  ) => {
    const resp = await patchCourse(token, courseKey, { visible });
    onUpdate(resp);
  };

  const handleRotateFeed = async () => {
    if (
      !window.confirm(
        "Rotate your calendar feed URL? Any previously subscribed Apple/Google calendars will need the new URL."
      )
    ) {
      return;
    }
    const resp = await rotateFeedToken(token);
    onUpdate(resp);
    onToast("Calendar feed token rotated");
  };

  const handleDelete = async () => {
    if (
      !window.confirm(
        "Permanently delete this workspace, your saved Moodle URL, and all tracked statuses?"
      )
    ) {
      return;
    }
    await deleteWorkspace(token);
    onDeleted();
  };

  const previewLines = useMemo(() => {
    const base = {
      uid: "preview",
      description: "",
      moodleStatus: "unknown" as const,
      moodleStatusDetail: null,
      statusSource: "moodle" as const,
      courseDisplayName: settings.labelLang === "he" ? "אלגוריתמים" : "Algorithms",
      courseShortname: "0368-2158-01",
      moodleUrl: null,
      note: null,
    };
    return [
      {
        label: "Completed",
        text: formatCalendarSummary(
          {
            ...base,
            summary: settings.labelLang === "he" ? "תרגיל בית 1" : "HW 1",
            isProblemSet: true,
            effectiveStatus: "completed",
            isOverdue: false,
          },
          settings
        ),
        cls: "text-emerald-800 bg-emerald-50 border-emerald-200",
      },
      {
        label: "Not Completed",
        text: formatCalendarSummary(
          {
            ...base,
            summary: settings.labelLang === "he" ? "תרגיל בית 2" : "HW 2",
            isProblemSet: true,
            effectiveStatus: "not_completed",
            isOverdue: false,
          },
          settings
        ),
        cls: "text-slate-800 bg-slate-50 border-slate-200",
      },
      {
        label: "In Progress",
        text: formatCalendarSummary(
          {
            ...base,
            summary: settings.labelLang === "he" ? "תרגיל בית 3" : "HW 3",
            isProblemSet: true,
            effectiveStatus: "in_progress",
            isOverdue: false,
          },
          settings
        ),
        cls: "text-amber-800 bg-amber-50 border-amber-200",
      },
      {
        label: "Overdue",
        text: formatCalendarSummary(
          {
            ...base,
            summary: settings.labelLang === "he" ? "תרגיל בית 0" : "HW 0",
            isProblemSet: true,
            effectiveStatus: "not_completed",
            isOverdue: true,
          },
          settings
        ),
        cls: "text-red-800 bg-red-50 border-red-200",
      },
    ];
  }, [settings]);

  return (
    <div className="space-y-6">
      <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900">
        {t.settingsHeading}
      </h2>

      {/* Live Preview */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Live Calendar Title Preview
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {previewLines.map((p) => (
            <div
              key={p.label}
              className={`rounded-xl border px-3 py-2 text-xs sm:text-sm font-semibold ${p.cls}`}
            >
              {p.text}
            </div>
          ))}
        </div>
      </section>

      {/* Formatting & Reminders */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Calendar Name
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={calNameDraft}
                onChange={(e) => setCalNameDraft(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
              <button
                disabled={saving}
                onClick={() => savePatch({ calendarName: calNameDraft })}
                className="px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Status Label Language (in Calendar)
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: "en", label: "English (Completed / Not Completed)" },
                  { id: "he", label: "עברית (הושלם / לא הושלם)" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() =>
                    savePatch({ labelLang: opt.id as LabelLang })
                  }
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                    settings.labelLang === opt.id
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            Calendar Title Format
          </label>
          <div className="grid sm:grid-cols-3 gap-2">
            {(
              [
                {
                  id: "explicit",
                  title: "Explicit (Recommended)",
                  example: "✅ [Algo] HW 1 — Completed",
                },
                {
                  id: "compact",
                  title: "Compact Emoji",
                  example: "✅ [Algo] HW 1",
                },
                {
                  id: "text",
                  title: "Text Tags (No Emoji)",
                  example: "[DONE] [Algo] HW 1",
                },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => savePatch({ titleStyle: opt.id as TitleStyle })}
                className={`text-start p-3 rounded-xl border transition cursor-pointer ${
                  settings.titleStyle === opt.id
                    ? "border-sky-600 bg-sky-50 ring-1 ring-sky-600"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="text-xs font-bold text-slate-900">
                  {opt.title}
                </div>
                <div className="text-[11px] text-slate-600 mt-1">
                  {opt.example}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Toggles */}
        <div className="grid sm:grid-cols-2 gap-3 pt-1">
          {[
            {
              key: "includeCoursePrefix" as const,
              label: "Prefix event titles with [Course Name]",
            },
            {
              key: "showCompletedInCalendar" as const,
              label: "Keep completed problem sets in calendar (marked ✅)",
            },
            {
              key: "showNonProblemSetsInCalendar" as const,
              label: "Include non-problem-set Moodle events (lectures, etc.)",
            },
            {
              key: "muteRemindersWhenCompleted" as const,
              label: "Automatically mute reminders once a problem set is completed",
            },
          ].map((item) => (
            <label
              key={item.key}
              className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/70 text-xs sm:text-sm text-slate-800 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={settings[item.key]}
                onChange={(e) => savePatch({ [item.key]: e.target.checked })}
                className="rounded text-sky-600"
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>

        {/* Deadline Duration & Reminders */}
        <div className="grid sm:grid-cols-2 gap-5 pt-1">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Visible Calendar Block for Due Dates
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[0, 15, 30, 60].map((mins) => (
                <button
                  key={mins}
                  onClick={() => savePatch({ deadlineDurationMinutes: mins })}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                    settings.deadlineDurationMinutes === mins
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-300"
                  }`}
                >
                  {mins === 0 ? "0 min (instant)" : `${mins} min`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Default Calendar Reminders (VALARM)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {REMINDER_OPTIONS.map((opt) => {
                const active = settings.reminderMinutes.includes(opt.mins);
                return (
                  <button
                    key={opt.mins}
                    onClick={() => toggleReminder(opt.mins)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                      active
                        ? "bg-sky-700 text-white border-sky-700"
                        : "bg-white text-slate-700 border-slate-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Courses Alias & Visibility */}
      {data.courses.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Courses &amp; Short Display Names
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Replace cryptic TAU course codes (e.g. 0368-2158-01) with short
              calendar labels or hide courses you don&apos;t want synced.
            </p>
          </div>

          <div className="space-y-2.5">
            {data.courses.map((course) => (
              <div
                key={course.courseKey}
                className="flex flex-col sm:flex-row sm:items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/50"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">
                    {course.fullname || course.shortname}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    {course.shortname}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={courseDrafts[course.courseKey] ?? ""}
                    onChange={(e) =>
                      setCourseDrafts((d) => ({
                        ...d,
                        [course.courseKey]: e.target.value,
                      }))
                    }
                    placeholder="Custom short name..."
                    className="w-40 sm:w-44 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                  />
                  <button
                    onClick={() => handleSaveCourseAlias(course.courseKey)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    onClick={() =>
                      handleToggleCourseVisible(
                        course.courseKey,
                        !course.visible
                      )
                    }
                    title={course.visible ? "Hide course" : "Show course"}
                    className={`p-1.5 rounded-lg border cursor-pointer ${
                      course.visible
                        ? "border-slate-300 bg-white text-slate-700"
                        : "border-amber-300 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {course.visible ? (
                      <Eye className="w-4 h-4" />
                    ) : (
                      <EyeOff className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Privacy & Security */}
      <section className="bg-white rounded-2xl border border-red-200 p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-red-900 font-bold text-base">
          <ShieldAlert className="w-5 h-5 text-red-600" />
          <span>Security &amp; Workspace Controls</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleRotateFeed}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Rotate Calendar Feed Token</span>
          </button>
          <button
            onClick={handleDelete}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Workspace &amp; Stored Data</span>
          </button>
        </div>
      </section>
    </div>
  );
}
