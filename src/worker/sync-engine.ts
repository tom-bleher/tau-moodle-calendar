import {
  classifyIsProblemSet,
  resolveEffectiveStatus,
  resolveItemIsProblemSet,
} from "../shared/classifier";
import {
  formatCalendarDescription,
  formatCalendarSummary,
  getCourseDisplayName,
  getGoogleEventColor,
} from "../shared/formatting";
import { computeDisplayWindow, resolveItemReminders } from "../shared/ics-generator";
import { parseIcs } from "../shared/ics-parser";
import type {
  CourseRecord,
  EnrichedCalendarItem,
  FeedJsonEvent,
  FeedJsonResponse,
  MoodleSyncPayload,
  WorkspaceDashboardResponse,
  WorkspaceSummary,
} from "../shared/types";
import { decryptText, encryptText } from "./crypto";
import {
  listCourses,
  listItems,
  updateWorkspaceCache,
  updateWorkspaceFeedError,
  updateWorkspaceMoodleSyncTimestamp,
  updateWorkspaceMoodleUrl,
  type WorkspaceEntity,
} from "./db";
import { fetchMoodleIcs, validateMoodleExportUrl } from "./moodle-fetcher";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes between upstream TAU Moodle ICS fetches

export function toWorkspaceSummary(ws: WorkspaceEntity): WorkspaceSummary {
  return {
    id: ws.id,
    dashboardToken: ws.dashboardToken,
    feedToken: ws.feedToken,
    hasMoodleUrl: Boolean(ws.moodleUrlEncrypted),
    moodleBaseUrl: ws.moodleBaseUrl,
    isDemo: ws.isDemo,
    settings: ws.settings,
    cachedIcsAt: ws.cachedIcsAt,
    lastMoodleSyncAt: ws.lastMoodleSyncAt,
    lastFeedError: ws.lastFeedError,
    createdAt: ws.createdAt,
    updatedAt: ws.updatedAt,
  };
}

/**
 * Fetches live ICS from TAU Moodle (if cache is stale or force=true) and merges
 * events & courses into D1 while preserving manual completion overrides & Moodle sync states.
 */
export async function syncWorkspaceFromLiveIcs(
  db: D1Database,
  workspace: WorkspaceEntity,
  encryptionSecret: string,
  options: { force?: boolean; now?: Date } = {}
): Promise<{ refreshed: boolean; error: string | null }> {
  if (!workspace.moodleUrlEncrypted) {
    return { refreshed: false, error: null };
  }

  const now = options.now ?? new Date();
  if (!options.force && workspace.cachedIcsAt) {
    const ageMs = now.getTime() - Date.parse(workspace.cachedIcsAt);
    if (!Number.isNaN(ageMs) && ageMs < CACHE_TTL_MS) {
      return { refreshed: false, error: null };
    }
  }

  let exportUrl: string;
  try {
    exportUrl = await decryptText(workspace.moodleUrlEncrypted, encryptionSecret);
  } catch (err) {
    const msg = "Failed to decrypt saved Moodle export URL. Please reconnect Moodle.";
    await updateWorkspaceFeedError(db, workspace.id, msg);
    console.error(JSON.stringify({ message: "decrypt_failed", workspaceId: workspace.id, error: String(err) }));
    return { refreshed: false, error: msg };
  }

  try {
    const { icsText, fetchedAt } = await fetchMoodleIcs(exportUrl);
    const parsed = parseIcs(icsText);

    // Load existing items to match by moodleEventId when UID host varies slightly
    const existingItems = await listItems(db, workspace.id);
    const existingByUid = new Map(existingItems.map((i) => [i.uid, i]));
    const existingByEventId = new Map<number, (typeof existingItems)[number]>();
    for (const item of existingItems) {
      if (item.moodleEventId !== null) {
        existingByEventId.set(item.moodleEventId, item);
      }
    }

    const statements: D1PreparedStatement[] = [];
    const seenUids = new Set<string>();
    const seenCourses = new Set<string>();

    for (const ev of parsed.events) {
      const courseKey = ev.categories[0] || null;
      if (courseKey && !seenCourses.has(courseKey)) {
        seenCourses.add(courseKey);
        statements.push(
          db
            .prepare(
              `INSERT INTO courses (workspace_id, course_key, shortname, visible, updated_at)
               VALUES (?, ?, ?, 1, ?)
               ON CONFLICT(workspace_id, course_key) DO UPDATE SET
                 shortname = excluded.shortname,
                 updated_at = excluded.updated_at`
            )
            .bind(workspace.id, courseKey, courseKey, fetchedAt)
        );
      }

      const matchedExisting =
        existingByUid.get(ev.uid) ??
        (ev.moodleEventId !== null
          ? existingByEventId.get(ev.moodleEventId)
          : undefined);

      const targetUid = matchedExisting ? matchedExisting.uid : ev.uid;
      seenUids.add(targetUid);

      const isPsAuto = classifyIsProblemSet({
        summary: ev.summary,
        description: ev.description,
        modulename: matchedExisting?.modulename ?? null,
        eventtype: matchedExisting?.eventtype ?? null,
      });

      statements.push(
        db
          .prepare(
            `INSERT INTO calendar_items (
              workspace_id, uid, moodle_event_id, course_key, summary, description,
              location, dtstart, dtend, is_all_day, last_modified, moodle_url,
              is_problem_set_auto, in_live_feed, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT(workspace_id, uid) DO UPDATE SET
              moodle_event_id = COALESCE(excluded.moodle_event_id, calendar_items.moodle_event_id),
              course_key = COALESCE(excluded.course_key, calendar_items.course_key),
              summary = excluded.summary,
              description = CASE WHEN excluded.description != '' THEN excluded.description ELSE calendar_items.description END,
              location = excluded.location,
              dtstart = excluded.dtstart,
              dtend = excluded.dtend,
              is_all_day = excluded.is_all_day,
              last_modified = excluded.last_modified,
              moodle_url = COALESCE(calendar_items.moodle_url, excluded.moodle_url),
              is_problem_set_auto = CASE WHEN calendar_items.modulename IS NOT NULL THEN calendar_items.is_problem_set_auto ELSE excluded.is_problem_set_auto END,
              in_live_feed = 1,
              updated_at = excluded.updated_at`
          )
          .bind(
            workspace.id,
            targetUid,
            ev.moodleEventId,
            courseKey,
            ev.summary,
            ev.description,
            ev.location,
            ev.dtstart,
            ev.dtend,
            ev.isAllDay ? 1 : 0,
            ev.lastModified,
            ev.url,
            isPsAuto ? 1 : 0,
            fetchedAt
          )
      );
    }

    // Mark future non-manual items missing from live ICS as not in_live_feed
    const nowIso = now.toISOString();
    for (const item of existingItems) {
      if (
        item.modulename !== "manual" &&
        !seenUids.has(item.uid) &&
        item.dtend >= nowIso &&
        item.inLiveFeed
      ) {
        statements.push(
          db
            .prepare(
              `UPDATE calendar_items SET in_live_feed = 0, updated_at = ?
               WHERE workspace_id = ? AND uid = ?`
            )
            .bind(fetchedAt, workspace.id, item.uid)
        );
      }
    }

    if (statements.length > 0) {
      // D1 batch executes cleanly in chunks
      const chunkSize = 80;
      for (let i = 0; i < statements.length; i += chunkSize) {
        await db.batch(statements.slice(i, i + chunkSize));
      }
    }

    await updateWorkspaceCache(db, workspace.id, icsText, fetchedAt);
    workspace.cachedIcs = icsText;
    workspace.cachedIcsAt = fetchedAt;
    workspace.lastFeedError = null;

    return { refreshed: true, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch TAU Moodle feed";
    await updateWorkspaceFeedError(db, workspace.id, msg);
    workspace.lastFeedError = msg;
    console.error(
      JSON.stringify({
        message: "moodle_ics_fetch_error",
        workspaceId: workspace.id,
        error: msg,
      })
    );
    return { refreshed: false, error: msg };
  }
}

/**
 * Applies rich authenticated sync data pushed from the TAU Moodle Bookmarklet or Browser Extension:
 * - Saves encrypted Moodle export URL (if extracted)
 * - Populates full Hebrew/English course titles
 * - Updates live submission/grading/draft completion statuses from Moodle
 */
export async function applyMoodleBrowserSync(
  db: D1Database,
  workspace: WorkspaceEntity,
  payload: MoodleSyncPayload,
  encryptionSecret: string
): Promise<void> {
  const syncedAt = payload.syncedAt || new Date().toISOString();
  const isSwitchingFromDemo =
    workspace.isDemo &&
    payload.exportUrl &&
    payload.exportUrl !== "demo://tau-2026";

  // Clear demo items when a user connects their real TAU Moodle account
  if (isSwitchingFromDemo) {
    await db.batch([
      db
        .prepare("DELETE FROM calendar_items WHERE workspace_id = ?")
        .bind(workspace.id),
      db
        .prepare("DELETE FROM courses WHERE workspace_id = ?")
        .bind(workspace.id),
    ]);
  }

  if (payload.exportUrl) {
    const validated = validateMoodleExportUrl(payload.exportUrl);
    const encrypted = await encryptText(
      validated.normalizedUrl,
      encryptionSecret
    );
    await updateWorkspaceMoodleUrl(
      db,
      workspace.id,
      encrypted,
      validated.moodleBaseUrl,
      validated.isDemo
    );
    workspace.moodleUrlEncrypted = encrypted;
    workspace.moodleBaseUrl = validated.moodleBaseUrl;
    workspace.isDemo = validated.isDemo;
  }

  const statements: D1PreparedStatement[] = [];

  // 1. Upsert courses with full names
  for (const course of payload.courses ?? []) {
    if (!course.shortname) continue;
    statements.push(
      db
        .prepare(
          `INSERT INTO courses (workspace_id, course_key, moodle_course_id, shortname, fullname, visible, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT(workspace_id, course_key) DO UPDATE SET
             moodle_course_id = COALESCE(excluded.moodle_course_id, courses.moodle_course_id),
             fullname = COALESCE(excluded.fullname, courses.fullname),
             updated_at = excluded.updated_at`
        )
        .bind(
          workspace.id,
          course.shortname,
          course.id ?? null,
          course.shortname,
          course.fullname ?? null,
          syncedAt
        )
    );
  }

  // 2. Match & upsert events with Moodle submission statuses
  const existingItems = await listItems(db, workspace.id);
  const existingByEventId = new Map<number, (typeof existingItems)[number]>();
  const existingByUid = new Map(existingItems.map((i) => [i.uid, i]));
  for (const it of existingItems) {
    if (it.moodleEventId !== null) existingByEventId.set(it.moodleEventId, it);
  }

  const hostFallback = (
    payload.moodleBaseUrl ||
    workspace.moodleBaseUrl ||
    "https://moodle.tau.ac.il/2026"
  ).replace(/^https?:\/\//, "");

  for (const ev of payload.events ?? []) {
    if (!Number.isFinite(ev.eventId) || !ev.name) continue;

    if (ev.courseShortname) {
      statements.push(
        db
          .prepare(
            `INSERT INTO courses (workspace_id, course_key, moodle_course_id, shortname, fullname, visible, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?)
             ON CONFLICT(workspace_id, course_key) DO UPDATE SET
               moodle_course_id = COALESCE(excluded.moodle_course_id, courses.moodle_course_id),
               fullname = COALESCE(excluded.fullname, courses.fullname),
               updated_at = excluded.updated_at`
          )
          .bind(
            workspace.id,
            ev.courseShortname,
            ev.courseId ?? null,
            ev.courseShortname,
            ev.courseFullname ?? null,
            syncedAt
          )
      );
    }

    const matched =
      existingByEventId.get(ev.eventId) ??
      (ev.uid ? existingByUid.get(ev.uid) : undefined);

    const uid = matched ? matched.uid : ev.uid || `${ev.eventId}@${hostFallback}`;
    const dtstart = new Date(ev.timestart * 1000).toISOString();
    const dtend = new Date(
      (ev.timestart + (ev.timeduration || 0)) * 1000
    ).toISOString();

    const isPsAuto = classifyIsProblemSet({
      summary: ev.name,
      description: ev.description || "",
      modulename: ev.modulename ?? null,
      eventtype: ev.eventtype ?? null,
    });

    const moodleStatus = ev.moodleStatus || "unknown";
    const statusTimestamp = moodleStatus !== "unknown" ? syncedAt : null;

    statements.push(
      db
        .prepare(
          `INSERT INTO calendar_items (
            workspace_id, uid, moodle_event_id, course_key, summary, description,
            dtstart, dtend, is_all_day, modulename, eventtype, moodle_url,
            is_problem_set_auto, moodle_status, moodle_status_detail,
            moodle_status_updated_at, in_live_feed, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(workspace_id, uid) DO UPDATE SET
            moodle_event_id = excluded.moodle_event_id,
            course_key = COALESCE(excluded.course_key, calendar_items.course_key),
            summary = excluded.summary,
            description = CASE WHEN excluded.description != '' THEN excluded.description ELSE calendar_items.description END,
            dtstart = excluded.dtstart,
            dtend = excluded.dtend,
            modulename = COALESCE(excluded.modulename, calendar_items.modulename),
            eventtype = COALESCE(excluded.eventtype, calendar_items.eventtype),
            moodle_url = COALESCE(excluded.moodle_url, calendar_items.moodle_url),
            is_problem_set_auto = excluded.is_problem_set_auto,
            moodle_status = CASE WHEN excluded.moodle_status != 'unknown' THEN excluded.moodle_status ELSE calendar_items.moodle_status END,
            moodle_status_detail = COALESCE(excluded.moodle_status_detail, calendar_items.moodle_status_detail),
            moodle_status_updated_at = COALESCE(excluded.moodle_status_updated_at, calendar_items.moodle_status_updated_at),
            in_live_feed = 1,
            updated_at = excluded.updated_at`
        )
        .bind(
          workspace.id,
          uid,
          ev.eventId,
          ev.courseShortname ?? null,
          ev.name,
          ev.description ?? "",
          dtstart,
          dtend,
          ev.modulename ?? null,
          ev.eventtype ?? null,
          ev.url ?? null,
          isPsAuto ? 1 : 0,
          moodleStatus,
          ev.moodleStatusDetail ?? null,
          statusTimestamp,
          syncedAt
        )
    );
  }

  if (statements.length > 0) {
    const chunkSize = 80;
    for (let i = 0; i < statements.length; i += chunkSize) {
      await db.batch(statements.slice(i, i + chunkSize));
    }
  }

  await updateWorkspaceMoodleSyncTimestamp(
    db,
    workspace.id,
    syncedAt,
    payload.moodleBaseUrl
  );
  workspace.lastMoodleSyncAt = syncedAt;

  // Also pull live ICS if an export URL is set so any events outside the 6-month AJAX view are synced too
  if (workspace.moodleUrlEncrypted) {
    await syncWorkspaceFromLiveIcs(db, workspace, encryptionSecret, {
      force: true,
    });
  }
}

export async function loadEnrichedItems(
  db: D1Database,
  workspace: WorkspaceEntity,
  appOrigin: string,
  now: Date = new Date()
): Promise<{ courses: CourseRecord[]; items: EnrichedCalendarItem[] }> {
  const [courses, rawItems] = await Promise.all([
    listCourses(db, workspace.id),
    listItems(db, workspace.id),
  ]);

  const courseMap = new Map(courses.map((c) => [c.courseKey, c]));
  const nowMs = now.getTime();
  const dashboardBase = `${appOrigin.replace(/\/+$/, "")}/w/${encodeURIComponent(workspace.dashboardToken)}`;

  const items: EnrichedCalendarItem[] = rawItems
    .filter((i) => i.inLiveFeed)
    .map((item) => {
      const course = item.courseKey ? courseMap.get(item.courseKey) : undefined;
      const courseDisplayName = getCourseDisplayName(course, item.courseKey);
      const courseVisible = course ? course.visible : true;
      const isProblemSet = resolveItemIsProblemSet(item);
      const { effectiveStatus, statusSource, isOverdue } =
        resolveEffectiveStatus(item, isProblemSet, nowMs);

      const formatInput = {
        uid: item.uid,
        summary: item.summary,
        description: item.description,
        isProblemSet,
        effectiveStatus,
        moodleStatus: item.moodleStatus,
        moodleStatusDetail: item.moodleStatusDetail,
        statusSource,
        isOverdue,
        courseDisplayName,
        courseShortname: course?.shortname ?? item.courseKey,
        moodleUrl: item.moodleUrl,
        note: item.note,
        dashboardUrl: `${dashboardBase}#item=${encodeURIComponent(item.uid)}`,
      };

      return {
        ...item,
        isProblemSet,
        effectiveStatus,
        statusSource,
        isOverdue,
        courseDisplayName,
        courseVisible,
        formattedSummary: formatCalendarSummary(formatInput, workspace.settings),
        formattedDescription: formatCalendarDescription(
          formatInput,
          workspace.settings
        ),
      };
    });

  return { courses, items };
}

export async function buildDashboardResponse(
  db: D1Database,
  workspace: WorkspaceEntity,
  appOrigin: string,
  now: Date = new Date()
): Promise<WorkspaceDashboardResponse> {
  const { courses, items } = await loadEnrichedItems(
    db,
    workspace,
    appOrigin,
    now
  );

  let totalProblemSets = 0;
  let completedCount = 0;
  let inProgressCount = 0;
  let notCompletedCount = 0;
  let overdueCount = 0;
  let otherEventsCount = 0;

  for (const item of items) {
    if (!item.courseVisible) continue;
    if (item.isProblemSet) {
      totalProblemSets++;
      if (item.effectiveStatus === "completed") completedCount++;
      else if (item.effectiveStatus === "in_progress") inProgressCount++;
      else notCompletedCount++;
      if (item.isOverdue) overdueCount++;
    } else {
      otherEventsCount++;
    }
  }

  return {
    workspace: toWorkspaceSummary(workspace),
    courses,
    items,
    stats: {
      totalProblemSets,
      completedCount,
      inProgressCount,
      notCompletedCount,
      overdueCount,
      otherEventsCount,
    },
  };
}

export function buildFeedJsonResponse(
  workspace: WorkspaceEntity,
  items: EnrichedCalendarItem[],
  now: Date = new Date()
): FeedJsonResponse {
  const settings = workspace.settings;
  const events: FeedJsonEvent[] = [];

  for (const item of items) {
    if (!item.courseVisible) continue;
    if (!item.isProblemSet && !settings.showNonProblemSetsInCalendar) continue;
    if (
      item.isProblemSet &&
      item.effectiveStatus === "completed" &&
      !settings.showCompletedInCalendar
    ) {
      continue;
    }

    const { start, end } = computeDisplayWindow(
      item,
      settings.deadlineDurationMinutes
    );

    events.push({
      uid: item.uid,
      summary: item.formattedSummary,
      rawSummary: item.summary,
      description: item.formattedDescription,
      location: item.location,
      start: start.toISOString(),
      end: end.toISOString(),
      isAllDay: item.isAllDay,
      isProblemSet: item.isProblemSet,
      status: item.effectiveStatus,
      moodleStatus: item.moodleStatus,
      statusSource: item.statusSource,
      isOverdue: item.isOverdue,
      courseKey: item.courseKey,
      courseName: item.courseDisplayName,
      moodleUrl: item.moodleUrl,
      reminderMinutes: resolveItemReminders(item, settings),
      googleColor: getGoogleEventColor(
        item.isProblemSet,
        item.effectiveStatus,
        item.isOverdue
      ),
    });
  }

  return {
    calendarName: settings.calendarName,
    timezone: settings.timezone,
    generatedAt: now.toISOString(),
    lastMoodleSyncAt: workspace.lastMoodleSyncAt,
    events,
  };
}
