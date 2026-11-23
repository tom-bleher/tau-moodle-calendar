import type {
  CalendarItemRecord,
  CompletionStatus,
  MoodleStatus,
} from "./types";

const PROBLEM_SET_MODULES = new Set([
  "assign",
  "quiz",
  "vpl",
  "workshop",
  "coderunner",
  "turnitintooltwo",
  "peerwork",
]);

const PROBLEM_SET_EVENT_TYPES = new Set([
  "due",
  "close",
  "expectcompletionon",
  "submission",
  "gradingdue",
]);

// Explicitly non-problem-set class/meeting keywords (note Hebrew תרגול = recitation vs תרגיל = homework)
const NON_PROBLEM_SET_PATTERNS: RegExp[] = [
  /(?:^|[\s\-–—:])(תרגול|שיעור תרגול|הרצאה|שיעור|שעת קבלה|שעות קבלה|מפגש זום|זום)(?:$|[\s\-–—:0-9])/i,
  /\b(lecture|recitation|tutorial|office\s+hours?|zoom\s+meeting|webinar|class\s+session)\b/i,
];

// Hebrew & English problem set / assignment / quiz deadline indicators
const PROBLEM_SET_PATTERNS: RegExp[] = [
  // Hebrew: תרגיל (homework/problem set), מטלה (assignment), בוחן (quiz), עבודה (paper/project), הגשה (submission)
  /(?:^|[\s\-–—:(\[])(תרגיל(?:\s+בית|\s+תכנות|\s+רשות|\s+חובה)?|תרגילי\s+בית|מטל[הת]|בוחן|עבוד[הת](?:\s+בית)?|פרויקט|מעבד[הת]|דו["״]?ח\s+מעבדה|יש\s+להגיש|להגשה|מועד\s+אחרון\s+להגשה|תאריך\s+הגשה|תרגילי\s+הגשה)/i,
  // English: problem set, pset, hw, assignment, quiz, lab, exercise, due/closes
  /\b(problem\s*set|p\.?s\.?\s*\d+|pset\s*\d*|hw\s*#?\d*|homework|assignment|exercise\s*#?\d*|ex\.?\s*#?\d+|quiz\s*#?\d*|lab\s*#?\d*|worksheet|submission|is\s+due|due\s+date|closes)\b/i,
];

export interface ClassificationInput {
  summary: string;
  description?: string;
  modulename?: string | null;
  eventtype?: string | null;
}

/**
 * Determine whether a Moodle calendar event represents a problem set / assignment / quiz.
 */
export function classifyIsProblemSet(input: ClassificationInput): boolean {
  const mod = (input.modulename || "").toLowerCase().trim();
  const evType = (input.eventtype || "").toLowerCase().trim();

  if (mod && PROBLEM_SET_MODULES.has(mod)) {
    // Exclude "open" notifications if we only want actionable deadlines; due/close/submission are problem sets
    if (evType === "open") return false;
    return true;
  }

  if (evType && PROBLEM_SET_EVENT_TYPES.has(evType)) {
    return true;
  }

  const summary = input.summary || "";
  const description = input.description || "";

  // Check strong assignment patterns in summary first
  for (const re of PROBLEM_SET_PATTERNS) {
    if (re.test(summary)) return true;
  }

  // If summary looks explicitly like a lecture/recitation/Zoom, don't treat as problem set
  for (const re of NON_PROBLEM_SET_PATTERNS) {
    if (re.test(summary)) return false;
  }

  // Fall back to description signals (e.g. Moodle puts mod/assign link or submission instructions in description)
  if (/\/mod\/(assign|quiz|vpl|workshop)\/view\.php/i.test(description)) {
    return true;
  }
  for (const re of PROBLEM_SET_PATTERNS) {
    if (re.test(description)) return true;
  }

  return false;
}

export function resolveItemIsProblemSet(item: {
  isProblemSetAuto: boolean;
  isProblemSetManual: boolean | null;
}): boolean {
  if (item.isProblemSetManual !== null) {
    return item.isProblemSetManual;
  }
  return item.isProblemSetAuto;
}

export function moodleStatusToCompletion(
  status: MoodleStatus
): CompletionStatus | null {
  switch (status) {
    case "submitted":
    case "graded":
      return "completed";
    case "draft":
      return "in_progress";
    case "not_submitted":
      return "not_completed";
    case "unknown":
    default:
      return null;
  }
}

export interface ResolvedStatus {
  effectiveStatus: CompletionStatus;
  statusSource: "manual" | "moodle" | "default";
  isOverdue: boolean;
}

/**
 * Resolve final completion state with clear precedence:
 * 1. Explicit manual status overrides Moodle (unless cleared or auto-upgraded on newer Moodle submission).
 * 2. Moodle auto-detected submission/grading status.
 * 3. Default "not_completed".
 */
export function resolveEffectiveStatus(
  item: Pick<
    CalendarItemRecord,
    | "manualStatus"
    | "manualStatusUpdatedAt"
    | "moodleStatus"
    | "moodleStatusUpdatedAt"
    | "dtend"
    | "dtstart"
  >,
  isProblemSet: boolean,
  nowMs: number = Date.now()
): ResolvedStatus {
  let effectiveStatus: CompletionStatus = "not_completed";
  let statusSource: "manual" | "moodle" | "default" = "default";

  const moodleMapped = moodleStatusToCompletion(item.moodleStatus);

  if (item.manualStatus !== null) {
    // Smart upgrade: if user had marked in_progress/not_completed and Moodle later observed submitted/graded
    const moodleNewerSubmission =
      moodleMapped === "completed" &&
      item.manualStatus !== "completed" &&
      item.moodleStatusUpdatedAt !== null &&
      item.manualStatusUpdatedAt !== null &&
      item.moodleStatusUpdatedAt > item.manualStatusUpdatedAt;

    if (moodleNewerSubmission) {
      effectiveStatus = "completed";
      statusSource = "moodle";
    } else {
      effectiveStatus = item.manualStatus;
      statusSource = "manual";
    }
  } else if (moodleMapped !== null) {
    effectiveStatus = moodleMapped;
    statusSource = "moodle";
  }

  const dueTs = Date.parse(item.dtend || item.dtstart);
  const isOverdue =
    isProblemSet &&
    effectiveStatus !== "completed" &&
    !Number.isNaN(dueTs) &&
    dueTs < nowMs;

  return { effectiveStatus, statusSource, isOverdue };
}

/**
 * Clean common Moodle boilerplate suffixes from event titles without losing meaning.
 */
export function cleanMoodleEventTitle(rawSummary: string): string {
  return rawSummary
    .replace(/\s+(?:is\s+due|closes)\s*$/i, "")
    .replace(/\s*[-–—]?\s*(?:יש\s+להגיש|מועד\s+אחרון\s+להגשה)\s*$/i, "")
    .trim() || rawSummary.trim();
}
