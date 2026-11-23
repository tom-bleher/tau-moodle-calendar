export interface ParsedIcsEvent {
  uid: string;
  moodleEventId: number | null;
  summary: string;
  description: string;
  location: string | null;
  categories: string[];
  dtstart: string; // ISO-8601 UTC
  dtend: string; // ISO-8601 UTC
  isAllDay: boolean;
  lastModified: string | null;
  url: string | null;
}

export interface ParsedIcsCalendar {
  prodId: string | null;
  calName: string | null;
  events: ParsedIcsEvent[];
}

/**
 * Unfold RFC 5545 folded lines (CRLF or LF followed by a single space or horizontal tab).
 */
export function unfoldIcsLines(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawLines = normalized.split("\n");
  const unfolded: string[] = [];

  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  return unfolded;
}

/**
 * Unescape RFC 5545 TEXT values.
 */
export function unescapeIcsText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === "n" || next === "N") {
        out += "\n";
        i++;
      } else if (next === "," || next === ";" || next === "\\") {
        out += next;
        i++;
      } else {
        out += ch;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Resolve a local wall-clock date in a given IANA timezone to a UTC Date using Intl.
 */
function wallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const approxUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const partsToUtc = (ts: number): number => {
      const parts = dtf.formatToParts(new Date(ts));
      const get = (t: string) =>
        Number(parts.find((p) => p.type === t)?.value ?? "0");
      const h = get("hour") === 24 ? 0 : get("hour");
      return Date.UTC(
        get("year"),
        get("month") - 1,
        get("day"),
        h,
        get("minute"),
        get("second")
      );
    };

    // Two-pass adjustment cleanly handles DST transitions.
    const offset1 = partsToUtc(approxUtc) - approxUtc;
    const candidate = approxUtc - offset1;
    const offset2 = partsToUtc(candidate) - candidate;
    return new Date(approxUtc - offset2);
  } catch {
    return new Date(approxUtc);
  }
}

/**
 * Parse an iCalendar DTSTART/DTEND/LAST-MODIFIED value into an ISO-8601 UTC string.
 */
export function parseIcsDateTime(
  value: string,
  params: Record<string, string>,
  defaultTz = "Asia/Jerusalem"
): { iso: string; isAllDay: boolean } {
  const trimmed = value.trim();
  const valueType = (params["VALUE"] || "").toUpperCase();

  // Pure date: YYYYMMDD
  const dateOnlyMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch || valueType === "DATE") {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(trimmed);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      return {
        iso: new Date(Date.UTC(y, mo - 1, d, 0, 0, 0)).toISOString(),
        isAllDay: true,
      };
    }
  }

  // Date-time: YYYYMMDDTHHMMSS(Z)?
  const dtMatch =
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(trimmed);
  if (dtMatch) {
    const y = Number(dtMatch[1]);
    const mo = Number(dtMatch[2]);
    const d = Number(dtMatch[3]);
    const h = Number(dtMatch[4]);
    const mi = Number(dtMatch[5]);
    const s = Number(dtMatch[6]);
    const isUtc = dtMatch[7] === "Z";

    if (isUtc) {
      return {
        iso: new Date(Date.UTC(y, mo - 1, d, h, mi, s)).toISOString(),
        isAllDay: false,
      };
    }

    const tz = params["TZID"] || defaultTz;
    return {
      iso: wallClockToUtc(y, mo, d, h, mi, s, tz).toISOString(),
      isAllDay: false,
    };
  }

  // Fallback
  const fallback = new Date(trimmed);
  if (!Number.isNaN(fallback.getTime())) {
    return { iso: fallback.toISOString(), isAllDay: false };
  }
  return { iso: new Date(0).toISOString(), isAllDay: false };
}

function parsePropertyLine(line: string): {
  name: string;
  params: Record<string, string>;
  value: string;
} | null {
  let inQuotes = false;
  let colonIdx = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colonIdx = i;
      break;
    }
  }
  if (colonIdx === -1) return null;

  const head = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const segments = head.split(";");
  const name = (segments[0] || "").trim().toUpperCase();
  const params: Record<string, string> = {};

  for (let i = 1; i < segments.length; i++) {
    const eq = segments[i].indexOf("=");
    if (eq !== -1) {
      const k = segments[i].slice(0, eq).trim().toUpperCase();
      let v = segments[i].slice(eq + 1).trim();
      if (v.startsWith('"') && v.endsWith('"')) {
        v = v.slice(1, -1);
      }
      params[k] = v;
    }
  }

  return { name, params, value };
}

export function extractMoodleEventId(uid: string): number | null {
  const m = /^(\d+)@/.exec(uid.trim());
  if (!m) return null;
  const num = Number(m[1]);
  return Number.isSafeInteger(num) ? num : null;
}

export function extractUrlFromDescription(description: string): string | null {
  const m = /(https:\/\/moodle\.tau\.ac\.il\/[^\s<>"]+)/i.exec(description);
  return m ? m[1] : null;
}

/**
 * Parse an iCalendar (.ics) string into structured calendar events.
 */
export function parseIcs(raw: string): ParsedIcsCalendar {
  const lines = unfoldIcsLines(raw);
  let prodId: string | null = null;
  let calName: string | null = null;
  const events: ParsedIcsEvent[] = [];

  let inEvent = false;
  let inAlarm = false;
  let current: {
    uid?: string;
    summary?: string;
    description?: string;
    location?: string | null;
    categories: string[];
    dtstart?: { iso: string; isAllDay: boolean };
    dtend?: { iso: string; isAllDay: boolean };
    lastModified?: string | null;
    url?: string | null;
  } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      inAlarm = false;
      current = { categories: [] };
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent && current && current.uid && current.dtstart) {
        const description = current.description ?? "";
        const dtend = current.dtend ?? current.dtstart;
        events.push({
          uid: current.uid,
          moodleEventId: extractMoodleEventId(current.uid),
          summary: current.summary ?? "(Untitled Event)",
          description,
          location: current.location ?? null,
          categories: current.categories,
          dtstart: current.dtstart.iso,
          dtend: dtend.iso,
          isAllDay: current.dtstart.isAllDay,
          lastModified: current.lastModified ?? null,
          url: current.url ?? extractUrlFromDescription(description),
        });
      }
      inEvent = false;
      inAlarm = false;
      current = null;
      continue;
    }
    if (inEvent && line === "BEGIN:VALARM") {
      inAlarm = true;
      continue;
    }
    if (inEvent && line === "END:VALARM") {
      inAlarm = false;
      continue;
    }
    if (inAlarm) continue;

    const prop = parsePropertyLine(line);
    if (!prop) continue;

    if (!inEvent) {
      if (prop.name === "PRODID") prodId = prop.value;
      else if (prop.name === "X-WR-CALNAME") calName = unescapeIcsText(prop.value);
      continue;
    }

    if (!current) continue;

    switch (prop.name) {
      case "UID":
        current.uid = prop.value.trim();
        break;
      case "SUMMARY":
        current.summary = unescapeIcsText(prop.value).trim();
        break;
      case "DESCRIPTION":
        current.description = unescapeIcsText(prop.value).trim();
        break;
      case "LOCATION":
        current.location = unescapeIcsText(prop.value).trim() || null;
        break;
      case "URL":
        current.url = prop.value.trim() || null;
        break;
      case "CATEGORIES": {
        const cats = prop.value
          .split(/(?<!\\),/)
          .map((c) => unescapeIcsText(c).trim())
          .filter(Boolean);
        current.categories.push(...cats);
        break;
      }
      case "DTSTART":
        current.dtstart = parseIcsDateTime(prop.value, prop.params);
        break;
      case "DTEND":
        current.dtend = parseIcsDateTime(prop.value, prop.params);
        break;
      case "LAST-MODIFIED":
        current.lastModified = parseIcsDateTime(prop.value, prop.params).iso;
        break;
    }
  }

  return { prodId, calName, events };
}
