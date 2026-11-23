export type CompletionStatus = "completed" | "in_progress" | "not_completed";

export type MoodleStatus =
  | "submitted"
  | "graded"
  | "draft"
  | "not_submitted"
  | "unknown";

export type TitleStyle = "explicit" | "compact" | "text";
export type LabelLang = "en" | "he";

export interface WorkspaceSettings {
  calendarName: string;
  titleStyle: TitleStyle;
  labelLang: LabelLang;
  includeCoursePrefix: boolean;
  showCompletedInCalendar: boolean;
  showNonProblemSetsInCalendar: boolean;
  deadlineDurationMinutes: number;
  reminderMinutes: number[];
  muteRemindersWhenCompleted: boolean;
  timezone: string;
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  calendarName: "TAU Moodle",
  titleStyle: "explicit",
  labelLang: "en",
  includeCoursePrefix: true,
  showCompletedInCalendar: true,
  showNonProblemSetsInCalendar: true,
  deadlineDurationMinutes: 30,
  reminderMinutes: [1440, 120],
  muteRemindersWhenCompleted: true,
  timezone: "Asia/Jerusalem",
};

export interface CourseRecord {
  courseKey: string;
  moodleCourseId: number | null;
  shortname: string;
  fullname: string | null;
  customName: string | null;
  visible: boolean;
  color: string | null;
  updatedAt: string;
}

export interface CalendarItemRecord {
  uid: string;
  moodleEventId: number | null;
  courseKey: string | null;
  summary: string;
  description: string;
  location: string | null;
  dtstart: string; // ISO-8601 UTC string
  dtend: string; // ISO-8601 UTC string
  isAllDay: boolean;
  lastModified: string | null;
  modulename: string | null;
  eventtype: string | null;
  moodleUrl: string | null;
  isProblemSetAuto: boolean;
  isProblemSetManual: boolean | null;
  moodleStatus: MoodleStatus;
  moodleStatusDetail: string | null;
  moodleStatusUpdatedAt: string | null;
  manualStatus: CompletionStatus | null;
  manualStatusUpdatedAt: string | null;
  note: string | null;
  inLiveFeed: boolean;
  updatedAt: string;
}

export interface EnrichedCalendarItem extends CalendarItemRecord {
  isProblemSet: boolean;
  effectiveStatus: CompletionStatus;
  statusSource: "manual" | "moodle" | "default";
  isOverdue: boolean;
  courseDisplayName: string;
  courseVisible: boolean;
  formattedSummary: string;
  formattedDescription: string;
}

export interface MoodleSyncedCourse {
  id?: number;
  shortname: string;
  fullname?: string;
}

export interface MoodleSyncedEvent {
  eventId: number;
  uid?: string;
  name: string;
  description?: string;
  modulename?: string | null;
  eventtype?: string | null;
  timestart: number; // unix seconds
  timeduration?: number; // seconds
  courseShortname?: string;
  courseFullname?: string;
  courseId?: number;
  url?: string | null;
  moodleStatus: MoodleStatus;
  moodleStatusDetail?: string | null;
}

export interface MoodleSyncPayload {
  exportUrl?: string;
  moodleBaseUrl?: string;
  courses?: MoodleSyncedCourse[];
  events?: MoodleSyncedEvent[];
  syncedAt?: string;
}

export interface WorkspaceSummary {
  id: string;
  dashboardToken: string;
  feedToken: string;
  hasMoodleUrl: boolean;
  moodleBaseUrl: string | null;
  isDemo: boolean;
  settings: WorkspaceSettings;
  cachedIcsAt: string | null;
  lastMoodleSyncAt: string | null;
  lastFeedError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDashboardResponse {
  workspace: WorkspaceSummary;
  courses: CourseRecord[];
  items: EnrichedCalendarItem[];
  stats: {
    totalProblemSets: number;
    completedCount: number;
    inProgressCount: number;
    notCompletedCount: number;
    overdueCount: number;
    otherEventsCount: number;
  };
}

export interface FeedJsonEvent {
  uid: string;
  summary: string;
  rawSummary: string;
  description: string;
  location: string | null;
  start: string;
  end: string;
  isAllDay: boolean;
  isProblemSet: boolean;
  status: CompletionStatus;
  moodleStatus: MoodleStatus;
  statusSource: "manual" | "moodle" | "default";
  isOverdue: boolean;
  courseKey: string | null;
  courseName: string;
  moodleUrl: string | null;
  reminderMinutes: number[];
  googleColor: "GREEN" | "ORANGE" | "YELLOW" | "RED" | "BLUE";
}

export interface FeedJsonResponse {
  calendarName: string;
  timezone: string;
  generatedAt: string;
  lastMoodleSyncAt: string | null;
  events: FeedJsonEvent[];
}
