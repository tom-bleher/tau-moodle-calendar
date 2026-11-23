import {
  DEFAULT_WORKSPACE_SETTINGS,
  type CalendarItemRecord,
  type CompletionStatus,
  type CourseRecord,
  type MoodleStatus,
  type WorkspaceSettings,
} from "../shared/types";

export interface WorkspaceRow {
  id: string;
  dashboard_token: string;
  feed_token: string;
  moodle_url_encrypted: string | null;
  moodle_base_url: string | null;
  is_demo: number;
  settings_json: string;
  cached_ics: string | null;
  cached_ics_at: string | null;
  last_moodle_sync_at: string | null;
  last_feed_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceEntity {
  id: string;
  dashboardToken: string;
  feedToken: string;
  moodleUrlEncrypted: string | null;
  moodleBaseUrl: string | null;
  isDemo: boolean;
  settings: WorkspaceSettings;
  cachedIcs: string | null;
  cachedIcsAt: string | null;
  lastMoodleSyncAt: string | null;
  lastFeedError: string | null;
  createdAt: string;
  updatedAt: string;
}

export function parseSettingsJson(raw: string): WorkspaceSettings {
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceSettings>;
    return {
      ...DEFAULT_WORKSPACE_SETTINGS,
      ...parsed,
      reminderMinutes: Array.isArray(parsed.reminderMinutes)
        ? parsed.reminderMinutes
            .map(Number)
            .filter((n) => Number.isFinite(n) && n >= 0 && n <= 40320)
        : DEFAULT_WORKSPACE_SETTINGS.reminderMinutes,
    };
  } catch {
    return { ...DEFAULT_WORKSPACE_SETTINGS };
  }
}

function mapWorkspaceRow(row: WorkspaceRow): WorkspaceEntity {
  return {
    id: row.id,
    dashboardToken: row.dashboard_token,
    feedToken: row.feed_token,
    moodleUrlEncrypted: row.moodle_url_encrypted,
    moodleBaseUrl: row.moodle_base_url,
    isDemo: row.is_demo === 1,
    settings: parseSettingsJson(row.settings_json),
    cachedIcs: row.cached_ics,
    cachedIcsAt: row.cached_ics_at,
    lastMoodleSyncAt: row.last_moodle_sync_at,
    lastFeedError: row.last_feed_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface CourseRow {
  workspace_id: string;
  course_key: string;
  moodle_course_id: number | null;
  shortname: string;
  fullname: string | null;
  custom_name: string | null;
  visible: number;
  color: string | null;
  updated_at: string;
}

function mapCourseRow(row: CourseRow): CourseRecord {
  return {
    courseKey: row.course_key,
    moodleCourseId: row.moodle_course_id,
    shortname: row.shortname,
    fullname: row.fullname,
    customName: row.custom_name,
    visible: row.visible === 1,
    color: row.color,
    updatedAt: row.updated_at,
  };
}

interface ItemRow {
  workspace_id: string;
  uid: string;
  moodle_event_id: number | null;
  course_key: string | null;
  summary: string;
  description: string;
  location: string | null;
  dtstart: string;
  dtend: string;
  is_all_day: number;
  last_modified: string | null;
  modulename: string | null;
  eventtype: string | null;
  moodle_url: string | null;
  is_problem_set_auto: number;
  is_problem_set_manual: number | null;
  moodle_status: string;
  moodle_status_detail: string | null;
  moodle_status_updated_at: string | null;
  manual_status: string | null;
  manual_status_updated_at: string | null;
  note: string | null;
  in_live_feed: number;
  updated_at: string;
}

function mapItemRow(row: ItemRow): CalendarItemRecord {
  return {
    uid: row.uid,
    moodleEventId: row.moodle_event_id,
    courseKey: row.course_key,
    summary: row.summary,
    description: row.description,
    location: row.location,
    dtstart: row.dtstart,
    dtend: row.dtend,
    isAllDay: row.is_all_day === 1,
    lastModified: row.last_modified,
    modulename: row.modulename,
    eventtype: row.eventtype,
    moodleUrl: row.moodle_url,
    isProblemSetAuto: row.is_problem_set_auto === 1,
    isProblemSetManual:
      row.is_problem_set_manual === null
        ? null
        : row.is_problem_set_manual === 1,
    moodleStatus: (row.moodle_status as MoodleStatus) || "unknown",
    moodleStatusDetail: row.moodle_status_detail,
    moodleStatusUpdatedAt: row.moodle_status_updated_at,
    manualStatus: (row.manual_status as CompletionStatus | null) ?? null,
    manualStatusUpdatedAt: row.manual_status_updated_at,
    note: row.note,
    inLiveFeed: row.in_live_feed === 1,
    updatedAt: row.updated_at,
  };
}

export async function createWorkspace(
  db: D1Database,
  params: {
    id: string;
    dashboardToken: string;
    feedToken: string;
    moodleUrlEncrypted: string | null;
    moodleBaseUrl: string | null;
    isDemo: boolean;
    settings?: WorkspaceSettings;
  }
): Promise<WorkspaceEntity> {
  const now = new Date().toISOString();
  const settings = params.settings ?? DEFAULT_WORKSPACE_SETTINGS;
  await db
    .prepare(
      `INSERT INTO workspaces (
        id, dashboard_token, feed_token, moodle_url_encrypted, moodle_base_url,
        is_demo, settings_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      params.id,
      params.dashboardToken,
      params.feedToken,
      params.moodleUrlEncrypted,
      params.moodleBaseUrl,
      params.isDemo ? 1 : 0,
      JSON.stringify(settings),
      now,
      now
    )
    .run();

  return {
    id: params.id,
    dashboardToken: params.dashboardToken,
    feedToken: params.feedToken,
    moodleUrlEncrypted: params.moodleUrlEncrypted,
    moodleBaseUrl: params.moodleBaseUrl,
    isDemo: params.isDemo,
    settings,
    cachedIcs: null,
    cachedIcsAt: null,
    lastMoodleSyncAt: null,
    lastFeedError: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getWorkspaceByDashboardToken(
  db: D1Database,
  token: string
): Promise<WorkspaceEntity | null> {
  const row = await db
    .prepare("SELECT * FROM workspaces WHERE dashboard_token = ?")
    .bind(token)
    .first<WorkspaceRow>();
  return row ? mapWorkspaceRow(row) : null;
}

export async function getWorkspaceByFeedToken(
  db: D1Database,
  token: string
): Promise<WorkspaceEntity | null> {
  const row = await db
    .prepare("SELECT * FROM workspaces WHERE feed_token = ?")
    .bind(token)
    .first<WorkspaceRow>();
  return row ? mapWorkspaceRow(row) : null;
}

export async function updateWorkspaceMoodleUrl(
  db: D1Database,
  workspaceId: string,
  moodleUrlEncrypted: string,
  moodleBaseUrl: string,
  isDemo: boolean
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE workspaces
       SET moodle_url_encrypted = ?, moodle_base_url = ?, is_demo = ?, last_feed_error = NULL, updated_at = ?
       WHERE id = ?`
    )
    .bind(moodleUrlEncrypted, moodleBaseUrl, isDemo ? 1 : 0, now, workspaceId)
    .run();
}

export async function updateWorkspaceCache(
  db: D1Database,
  workspaceId: string,
  cachedIcs: string,
  cachedIcsAt: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE workspaces
       SET cached_ics = ?, cached_ics_at = ?, last_feed_error = NULL, updated_at = ?
       WHERE id = ?`
    )
    .bind(cachedIcs, cachedIcsAt, now, workspaceId)
    .run();
}

export async function updateWorkspaceFeedError(
  db: D1Database,
  workspaceId: string,
  errorMessage: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE workspaces SET last_feed_error = ?, updated_at = ? WHERE id = ?`
    )
    .bind(errorMessage, now, workspaceId)
    .run();
}

export async function updateWorkspaceMoodleSyncTimestamp(
  db: D1Database,
  workspaceId: string,
  syncedAt: string,
  moodleBaseUrl?: string
): Promise<void> {
  const now = new Date().toISOString();
  if (moodleBaseUrl) {
    await db
      .prepare(
        `UPDATE workspaces
         SET last_moodle_sync_at = ?, moodle_base_url = COALESCE(?, moodle_base_url), updated_at = ?
         WHERE id = ?`
      )
      .bind(syncedAt, moodleBaseUrl, now, workspaceId)
      .run();
  } else {
    await db
      .prepare(
        `UPDATE workspaces SET last_moodle_sync_at = ?, updated_at = ? WHERE id = ?`
      )
      .bind(syncedAt, now, workspaceId)
      .run();
  }
}

export async function updateWorkspaceSettings(
  db: D1Database,
  workspaceId: string,
  settings: WorkspaceSettings
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE workspaces SET settings_json = ?, updated_at = ? WHERE id = ?`
    )
    .bind(JSON.stringify(settings), now, workspaceId)
    .run();
}

export async function rotateWorkspaceFeedToken(
  db: D1Database,
  workspaceId: string,
  newFeedToken: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE workspaces SET feed_token = ?, updated_at = ? WHERE id = ?`
    )
    .bind(newFeedToken, now, workspaceId)
    .run();
}

export async function deleteWorkspace(
  db: D1Database,
  workspaceId: string
): Promise<void> {
  await db.batch([
    db
      .prepare("DELETE FROM calendar_items WHERE workspace_id = ?")
      .bind(workspaceId),
    db.prepare("DELETE FROM courses WHERE workspace_id = ?").bind(workspaceId),
    db.prepare("DELETE FROM workspaces WHERE id = ?").bind(workspaceId),
  ]);
}

export async function listCourses(
  db: D1Database,
  workspaceId: string
): Promise<CourseRecord[]> {
  const res = await db
    .prepare(
      `SELECT * FROM courses WHERE workspace_id = ? ORDER BY COALESCE(custom_name, fullname, shortname) ASC`
    )
    .bind(workspaceId)
    .all<CourseRow>();
  return (res.results ?? []).map(mapCourseRow);
}

export async function updateCoursePreferences(
  db: D1Database,
  workspaceId: string,
  courseKey: string,
  patch: {
    customName?: string | null;
    visible?: boolean;
    color?: string | null;
  }
): Promise<boolean> {
  const existing = await db
    .prepare(
      "SELECT * FROM courses WHERE workspace_id = ? AND course_key = ?"
    )
    .bind(workspaceId, courseKey)
    .first<CourseRow>();

  if (!existing) return false;

  const now = new Date().toISOString();
  const customName =
    patch.customName !== undefined ? patch.customName : existing.custom_name;
  const visible =
    patch.visible !== undefined ? (patch.visible ? 1 : 0) : existing.visible;
  const color = patch.color !== undefined ? patch.color : existing.color;

  await db
    .prepare(
      `UPDATE courses
       SET custom_name = ?, visible = ?, color = ?, updated_at = ?
       WHERE workspace_id = ? AND course_key = ?`
    )
    .bind(customName, visible, color, now, workspaceId, courseKey)
    .run();
  return true;
}

export async function listItems(
  db: D1Database,
  workspaceId: string
): Promise<CalendarItemRecord[]> {
  const res = await db
    .prepare(
      `SELECT * FROM calendar_items WHERE workspace_id = ? ORDER BY dtstart ASC`
    )
    .bind(workspaceId)
    .all<ItemRow>();
  return (res.results ?? []).map(mapItemRow);
}

export async function patchCalendarItem(
  db: D1Database,
  workspaceId: string,
  uid: string,
  patch: {
    manualStatus?: CompletionStatus | null;
    isProblemSetManual?: boolean | null;
    note?: string | null;
  }
): Promise<boolean> {
  const existing = await db
    .prepare("SELECT * FROM calendar_items WHERE workspace_id = ? AND uid = ?")
    .bind(workspaceId, uid)
    .first<ItemRow>();

  if (!existing) return false;

  const now = new Date().toISOString();
  const manualStatus =
    patch.manualStatus !== undefined
      ? patch.manualStatus
      : existing.manual_status;
  const manualStatusUpdatedAt =
    patch.manualStatus !== undefined
      ? patch.manualStatus === null
        ? null
        : now
      : existing.manual_status_updated_at;
  const isProblemSetManual =
    patch.isProblemSetManual !== undefined
      ? patch.isProblemSetManual === null
        ? null
        : patch.isProblemSetManual
          ? 1
          : 0
      : existing.is_problem_set_manual;
  const note = patch.note !== undefined ? patch.note : existing.note;

  await db
    .prepare(
      `UPDATE calendar_items
       SET manual_status = ?, manual_status_updated_at = ?,
           is_problem_set_manual = ?, note = ?, updated_at = ?
       WHERE workspace_id = ? AND uid = ?`
    )
    .bind(
      manualStatus,
      manualStatusUpdatedAt,
      isProblemSetManual,
      note,
      now,
      workspaceId,
      uid
    )
    .run();
  return true;
}

export async function createManualProblemSet(
  db: D1Database,
  workspaceId: string,
  input: {
    uid: string;
    summary: string;
    courseKey: string | null;
    dueIso: string;
    description?: string;
    moodleUrl?: string | null;
    status?: CompletionStatus;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];

  if (input.courseKey) {
    statements.push(
      db
        .prepare(
          `INSERT INTO courses (workspace_id, course_key, shortname, fullname, visible, updated_at)
           VALUES (?, ?, ?, ?, 1, ?)
           ON CONFLICT(workspace_id, course_key) DO NOTHING`
        )
        .bind(workspaceId, input.courseKey, input.courseKey, input.courseKey, now)
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO calendar_items (
          workspace_id, uid, moodle_event_id, course_key, summary, description,
          location, dtstart, dtend, is_all_day, last_modified, modulename, eventtype,
          moodle_url, is_problem_set_auto, is_problem_set_manual,
          moodle_status, moodle_status_detail, moodle_status_updated_at,
          manual_status, manual_status_updated_at, note, in_live_feed, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, ?, 0, ?, 'manual', 'due', ?, 1, 1, 'unknown', NULL, NULL, ?, ?, NULL, 1, ?)`
      )
      .bind(
        workspaceId,
        input.uid,
        input.courseKey,
        input.summary,
        input.description ?? "",
        input.dueIso,
        input.dueIso,
        now,
        input.moodleUrl ?? null,
        input.status ?? "not_completed",
        now,
        now
      )
  );

  await db.batch(statements);
}
