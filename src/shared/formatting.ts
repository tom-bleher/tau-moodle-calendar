import { cleanMoodleEventTitle } from "./classifier";
import type {
  CompletionStatus,
  CourseRecord,
  MoodleStatus,
  WorkspaceSettings,
} from "./types";

export interface FormatEventInput {
  uid: string;
  summary: string;
  description: string;
  isProblemSet: boolean;
  effectiveStatus: CompletionStatus;
  moodleStatus: MoodleStatus;
  moodleStatusDetail: string | null;
  statusSource: "manual" | "moodle" | "default";
  isOverdue: boolean;
  courseDisplayName: string;
  courseShortname: string | null;
  moodleUrl: string | null;
  note: string | null;
  dashboardUrl?: string;
}

const LABELS = {
  en: {
    completed: "Completed",
    in_progress: "In Progress",
    not_completed: "Not Completed",
    overdue: "Overdue",
    doneTag: "[DONE]",
    wipTag: "[WIP]",
    todoTag: "[TODO]",
    overdueTag: "[OVERDUE]",
    eventTag: "[EVENT]",
    statusLabel: "Status",
    courseLabel: "Course",
    moodleLinkLabel: "Moodle Link",
    manageLabel: "Update Status",
    noteLabel: "Note",
    sourceMoodleSubmitted: "Submitted on Moodle",
    sourceMoodleGraded: "Graded on Moodle",
    sourceMoodleDraft: "Draft saved on Moodle",
    sourceMoodleNotSubmitted: "Not submitted on Moodle",
    sourceManual: "Marked manually",
  },
  he: {
    completed: "הושלם",
    in_progress: "בתהליך",
    not_completed: "לא הושלם",
    overdue: "באיחור",
    doneTag: "[הושלם]",
    wipTag: "[בתהליך]",
    todoTag: "[להגשה]",
    overdueTag: "[באיחור]",
    eventTag: "[אירוע]",
    statusLabel: "סטטוס",
    courseLabel: "קורס",
    moodleLinkLabel: "קישור למודל",
    manageLabel: "עדכון סטטוס",
    noteLabel: "הערה",
    sourceMoodleSubmitted: "הוגש במודל",
    sourceMoodleGraded: "נבדק במודל",
    sourceMoodleDraft: "טיוטה במודל",
    sourceMoodleNotSubmitted: "טרם הוגש במודל",
    sourceManual: "סומן ידנית",
  },
} as const;

export function getCourseDisplayName(course: CourseRecord | undefined | null, fallbackKey: string | null): string {
  if (!course) return fallbackKey || "";
  if (course.customName && course.customName.trim()) return course.customName.trim();
  if (course.fullname && course.fullname.trim()) return course.fullname.trim();
  return course.shortname || fallbackKey || "";
}

export function formatCalendarSummary(
  input: FormatEventInput,
  settings: WorkspaceSettings
): string {
  const L = LABELS[settings.labelLang] || LABELS.en;
  const baseTitle = cleanMoodleEventTitle(input.summary);
  const coursePrefix =
    settings.includeCoursePrefix && input.courseDisplayName
      ? `[${input.courseDisplayName}] `
      : "";

  if (!input.isProblemSet) {
    if (settings.titleStyle === "text") {
      return `${coursePrefix}${baseTitle}`;
    }
    return `📅 ${coursePrefix}${baseTitle}`;
  }

  let emoji = "⬜";
  let statusWord: string = L.not_completed;
  let textTag: string = L.todoTag;

  if (input.effectiveStatus === "completed") {
    emoji = "✅";
    statusWord = L.completed;
    textTag = L.doneTag;
  } else if (input.isOverdue) {
    emoji = "🔴";
    statusWord = L.overdue;
    textTag = L.overdueTag;
  } else if (input.effectiveStatus === "in_progress") {
    emoji = "🟡";
    statusWord = L.in_progress;
    textTag = L.wipTag;
  }

  switch (settings.titleStyle) {
    case "compact":
      return `${emoji} ${coursePrefix}${baseTitle}`;
    case "text":
      return `${textTag} ${coursePrefix}${baseTitle}`;
    case "explicit":
    default:
      return `${emoji} ${coursePrefix}${baseTitle} — ${statusWord}`;
  }
}

export function formatCalendarDescription(
  input: FormatEventInput,
  settings: WorkspaceSettings
): string {
  const L = LABELS[settings.labelLang] || LABELS.en;
  const lines: string[] = [];

  if (input.isProblemSet) {
    let statusIcon = "⬜";
    let statusText: string = L.not_completed;
    if (input.effectiveStatus === "completed") {
      statusIcon = "✅";
      statusText = L.completed;
    } else if (input.isOverdue) {
      statusIcon = "🔴";
      statusText = `${L.not_completed} (${L.overdue})`;
    } else if (input.effectiveStatus === "in_progress") {
      statusIcon = "🟡";
      statusText = L.in_progress;
    }

    let sourceText = "";
    if (input.statusSource === "manual") {
      sourceText = L.sourceManual;
    } else if (input.statusSource === "moodle") {
      if (input.moodleStatus === "graded") sourceText = L.sourceMoodleGraded;
      else if (input.moodleStatus === "submitted") sourceText = L.sourceMoodleSubmitted;
      else if (input.moodleStatus === "draft") sourceText = L.sourceMoodleDraft;
      else if (input.moodleStatus === "not_submitted") sourceText = L.sourceMoodleNotSubmitted;
    }

    const detailSuffix = input.moodleStatusDetail
      ? ` — ${input.moodleStatusDetail}`
      : "";
    const paren = sourceText ? ` (${sourceText}${detailSuffix})` : "";
    lines.push(`${L.statusLabel}: ${statusIcon} ${statusText}${paren}`);
  }

  if (input.courseDisplayName) {
    const codePart =
      input.courseShortname && input.courseShortname !== input.courseDisplayName
        ? ` (${input.courseShortname})`
        : "";
    lines.push(`${L.courseLabel}: ${input.courseDisplayName}${codePart}`);
  }

  if (input.note && input.note.trim()) {
    lines.push(`${L.noteLabel}: ${input.note.trim()}`);
  }

  if (input.moodleUrl) {
    lines.push(`${L.moodleLinkLabel}: ${input.moodleUrl}`);
  }

  if (input.dashboardUrl) {
    lines.push(`${L.manageLabel}: ${input.dashboardUrl}`);
  }

  const orig = input.description.trim();
  if (orig) {
    if (lines.length > 0) lines.push("---");
    lines.push(orig);
  }

  return lines.join("\n");
}

export function getGoogleEventColor(
  isProblemSet: boolean,
  effectiveStatus: CompletionStatus,
  isOverdue: boolean
): "GREEN" | "ORANGE" | "YELLOW" | "RED" | "BLUE" {
  if (!isProblemSet) return "BLUE";
  if (effectiveStatus === "completed") return "GREEN";
  if (isOverdue) return "RED";
  if (effectiveStatus === "in_progress") return "YELLOW";
  return "ORANGE";
}
