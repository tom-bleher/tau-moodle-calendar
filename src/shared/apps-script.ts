/**
 * Generates a personalized Google Apps Script for near-real-time (every 15 min)
 * color-coded Google Calendar sync — bypassing Google's slow 12–24h ICS polling
 * without requiring Google OAuth app verification.
 */
export function generateGoogleAppsScript(
  feedJsonUrl: string,
  calendarName = "TAU Moodle"
): string {
  return `/**
 * TAU Moodle Calendar — Instant Color-Coded Google Calendar Sync
 *
 * Setup (30 seconds):
 *  1. Open https://script.google.com and click "New project"
 *  2. Replace everything in Code.gs with this script and click Save
 *  3. Select "setupTauMoodleSync" in the top toolbar and click Run
 *  4. Authorize Calendar access when prompted — done!
 *
 * Syncs every 15 minutes into a dedicated "${calendarName}" calendar:
 *  - Green  = Completed problem set (✅)
 *  - Orange = Upcoming not-completed problem set (⬜)
 *  - Yellow = In-progress / Draft problem set (🟡)
 *  - Red    = Overdue problem set (🔴)
 *  - Blue   = General lecture / course event (📅)
 */

const FEED_JSON_URL = ${JSON.stringify(feedJsonUrl)};
const CALENDAR_NAME = ${JSON.stringify(calendarName)};
const SYNC_INTERVAL_MINUTES = 15;

function setupTauMoodleSync() {
  removeTriggers_();
  ScriptApp.newTrigger("syncTauMoodleCalendar")
    .timeBased()
    .everyMinutes(SYNC_INTERVAL_MINUTES)
    .create();
  syncTauMoodleCalendar();
  Logger.log("TAU Moodle Calendar sync installed and initial sync finished.");
}

function removeTauMoodleSync() {
  removeTriggers_();
  Logger.log("TAU Moodle Calendar auto-sync trigger removed.");
}

function removeTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction() === "syncTauMoodleCalendar") {
      ScriptApp.deleteTrigger(t);
    }
  }
}

function getOrCreateCalendar_(name) {
  const existing = CalendarApp.getCalendarsByName(name);
  if (existing.length > 0) return existing[0];
  const cal = CalendarApp.createCalendar(name, {
    summary: "Tel Aviv University Moodle deadlines & problem set completion status",
    timeZone: "Asia/Jerusalem",
  });
  cal.setColor("#0F294A");
  return cal;
}

function mapColor_(colorName) {
  switch (colorName) {
    case "GREEN":  return CalendarApp.EventColor.GREEN;
    case "RED":    return CalendarApp.EventColor.RED;
    case "YELLOW": return CalendarApp.EventColor.YELLOW;
    case "ORANGE": return CalendarApp.EventColor.ORANGE;
    default:       return CalendarApp.EventColor.BLUE;
  }
}

function syncTauMoodleCalendar() {
  const response = UrlFetchApp.fetch(FEED_JSON_URL, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw new Error("Feed returned HTTP " + response.getResponseCode() + ": " + response.getContentText());
  }

  const data = JSON.parse(response.getContentText());
  const cal = getOrCreateCalendar_(data.calendarName || CALENDAR_NAME);
  const now = new Date();

  // Window: 90 days back to 365 days ahead
  const windowStart = new Date(now.getTime() - 90 * 86400 * 1000);
  const windowEnd = new Date(now.getTime() + 365 * 86400 * 1000);

  const existingEvents = cal.getEvents(windowStart, windowEnd);
  const byUid = {};
  for (const ev of existingEvents) {
    const uid = ev.getTag("moodleUid");
    if (uid) byUid[uid] = ev;
  }

  const seenUids = {};

  for (const item of data.events || []) {
    seenUids[item.uid] = true;
    const start = new Date(item.start);
    const end = new Date(item.end);
    const targetColor = mapColor_(item.googleColor);
    const reminders = Array.isArray(item.reminderMinutes) ? item.reminderMinutes : [];

    let ev = byUid[item.uid];
    if (!ev) {
      ev = item.isAllDay
        ? cal.createAllDayEvent(item.summary, start, {
            description: item.description || "",
            location: item.location || "",
          })
        : cal.createEvent(item.summary, start, end, {
            description: item.description || "",
            location: item.location || "",
          });
      ev.setTag("moodleUid", item.uid);
    } else {
      if (ev.getTitle() !== item.summary) ev.setTitle(item.summary);
      if (ev.getDescription() !== (item.description || "")) {
        ev.setDescription(item.description || "");
      }
      if ((ev.getLocation() || "") !== (item.location || "")) {
        ev.setLocation(item.location || "");
      }
      if (!item.isAllDay) {
        if (ev.getStartTime().getTime() !== start.getTime() || ev.getEndTime().getTime() !== end.getTime()) {
          ev.setTime(start, end);
        }
      }
    }

    if (ev.getColor() !== targetColor) {
      ev.setColor(targetColor);
    }

    ev.removeAllReminders();
    for (const mins of reminders) {
      if (mins >= 0 && mins <= 40320) {
        ev.addPopupReminder(mins);
      }
    }
  }

  // Delete future events removed from feed
  for (const uid in byUid) {
    if (!seenUids[uid]) {
      const ev = byUid[uid];
      if (ev.getEndTime().getTime() > now.getTime()) {
        ev.deleteEvent();
      }
    }
  }
}
`;
}
