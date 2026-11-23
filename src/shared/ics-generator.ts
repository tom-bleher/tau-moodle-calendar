import type { EnrichedCalendarItem, WorkspaceSettings } from "./types";

const encoder = new TextEncoder();

/**
 * Escape text values per RFC 5545 Section 3.3.11.
 */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\r\n/g, "\\n")
    .replace(/\r/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/**
 * Fold an iCalendar line at 75 UTF-8 octets without ever splitting a multi-byte UTF-8 sequence
 * (critical for Hebrew text and emoji!).
 */
export function foldIcsLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;

  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  let limit = 75;

  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > limit && current.length > 0) {
      chunks.push(current);
      current = " " + ch;
      currentBytes = 1 + chBytes;
      limit = 75;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks.join("\r\n");
}

function formatUtcTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}Z`
  );
}

function formatDateOnly(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}`
  );
}

function formatTrigger(minutesBefore: number): string {
  const mins = Math.max(0, Math.round(minutesBefore));
  if (mins === 0) return "PT0M";
  if (mins % 1440 === 0) return `-P${mins / 1440}D`;
  if (mins % 60 === 0) return `-PT${mins / 60}H`;
  return `-PT${mins}M`;
}

/**
 * Compute calendar event start/end bounds, giving zero-duration Moodle deadlines
 * a clean visible block ending at the deadline time.
 */
export function computeDisplayWindow(
  item: Pick<EnrichedCalendarItem, "dtstart" | "dtend" | "isAllDay">,
  deadlineDurationMinutes: number
): { start: Date; end: Date } {
  const start = new Date(item.dtstart);
  const end = new Date(item.dtend);

  if (item.isAllDay) {
    if (end.getTime() <= start.getTime()) {
      return {
        start,
        end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
      };
    }
    return { start, end };
  }

  if (end.getTime() <= start.getTime() && deadlineDurationMinutes > 0) {
    const durationMs = deadlineDurationMinutes * 60 * 1000;
    return {
      start: new Date(end.getTime() - durationMs),
      end,
    };
  }

  return { start, end };
}

export function resolveItemReminders(
  item: Pick<EnrichedCalendarItem, "isProblemSet" | "effectiveStatus">,
  settings: WorkspaceSettings
): number[] {
  if (!settings.reminderMinutes.length) return [];
  if (
    item.isProblemSet &&
    item.effectiveStatus === "completed" &&
    settings.muteRemindersWhenCompleted
  ) {
    return [];
  }
  return settings.reminderMinutes.filter((m) => Number.isFinite(m) && m >= 0);
}

export interface GenerateIcsOptions {
  filterStatus?: "all" | "incomplete" | "completed";
  now?: Date;
}

/**
 * Generate a full RFC 5545 compliant iCalendar (.ics) document for Apple & Google Calendar.
 */
export function generateIcs(
  items: EnrichedCalendarItem[],
  settings: WorkspaceSettings,
  options: GenerateIcsOptions = {}
): string {
  const now = options.now ?? new Date();
  const dtstamp = formatUtcTimestamp(now);
  const calName = settings.calendarName || "TAU Moodle";
  const tz = settings.timezone || "Asia/Jerusalem";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TAU Moodle Calendar//Problem Set Sync 1.0//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
    `X-WR-CALDESC:${escapeIcsText("Tel Aviv University Moodle deadlines with problem set completion tracking")}`,
    `X-WR-TIMEZONE:${escapeIcsText(tz)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];

  // Include standard Israel VTIMEZONE definition for maximum Apple/Outlook compatibility
  if (tz === "Asia/Jerusalem") {
    lines.push(
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Jerusalem",
      "X-LIC-LOCATION:Asia/Jerusalem",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:+0300",
      "TZOFFSETTO:+0200",
      "TZNAME:IST",
      "DTSTART:19701025T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0300",
      "TZNAME:IDT",
      "DTSTART:19700327T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1FR",
      "END:DAYLIGHT",
      "END:VTIMEZONE"
    );
  }

  for (const item of items) {
    if (!item.courseVisible) continue;
    if (!item.isProblemSet && !settings.showNonProblemSetsInCalendar) continue;
    if (
      item.isProblemSet &&
      item.effectiveStatus === "completed" &&
      !settings.showCompletedInCalendar &&
      options.filterStatus !== "completed"
    ) {
      continue;
    }
    if (options.filterStatus === "incomplete") {
      if (!item.isProblemSet || item.effectiveStatus === "completed") continue;
    } else if (options.filterStatus === "completed") {
      if (!item.isProblemSet || item.effectiveStatus !== "completed") continue;
    }

    const { start, end } = computeDisplayWindow(
      item,
      settings.deadlineDurationMinutes
    );

    const categories: string[] = [];
    if (item.courseDisplayName) categories.push(item.courseDisplayName);
    if (item.isProblemSet) {
      if (item.effectiveStatus === "completed") categories.push("Completed");
      else if (item.isOverdue) categories.push("Overdue");
      else if (item.effectiveStatus === "in_progress") categories.push("In Progress");
      else categories.push("Not Completed");
    }

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${item.uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);

    if (item.isAllDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(start)}`);
      lines.push(`DTEND;VALUE=DATE:${formatDateOnly(end)}`);
    } else {
      lines.push(`DTSTART:${formatUtcTimestamp(start)}`);
      lines.push(`DTEND:${formatUtcTimestamp(end)}`);
    }

    lines.push(`SUMMARY:${escapeIcsText(item.formattedSummary)}`);
    if (item.formattedDescription) {
      lines.push(`DESCRIPTION:${escapeIcsText(item.formattedDescription)}`);
    }
    if (item.location) {
      lines.push(`LOCATION:${escapeIcsText(item.location)}`);
    }
    if (item.moodleUrl) {
      lines.push(`URL:${item.moodleUrl}`);
    }
    if (categories.length > 0) {
      lines.push(
        `CATEGORIES:${categories.map((c) => escapeIcsText(c)).join(",")}`
      );
    }

    lines.push("STATUS:CONFIRMED");
    lines.push(
      `TRANSP:${item.isProblemSet && item.effectiveStatus === "completed" ? "TRANSPARENT" : "OPAQUE"}`
    );

    // Custom X-properties for tools & Google Apps Script inspection
    lines.push(`X-TAU-PROBLEM-SET:${item.isProblemSet ? "TRUE" : "FALSE"}`);
    if (item.isProblemSet) {
      lines.push(
        `X-TAU-COMPLETION-STATUS:${item.effectiveStatus.toUpperCase()}`
      );
    }

    const lastMod = item.updatedAt
      ? new Date(item.updatedAt)
      : item.lastModified
        ? new Date(item.lastModified)
        : now;
    if (!Number.isNaN(lastMod.getTime())) {
      lines.push(`LAST-MODIFIED:${formatUtcTimestamp(lastMod)}`);
    }

    const reminders = resolveItemReminders(item, settings);
    for (const mins of reminders) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(`TRIGGER:${formatTrigger(mins)}`);
      lines.push(`DESCRIPTION:${escapeIcsText(item.formattedSummary)}`);
      lines.push("END:VALARM");
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
