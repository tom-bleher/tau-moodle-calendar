import { describe, expect, it } from "vitest";
import { generateIcs, foldIcsLine } from "../src/shared/ics-generator";
import { parseIcs, unfoldIcsLines } from "../src/shared/ics-parser";
import {
  DEFAULT_WORKSPACE_SETTINGS,
  type EnrichedCalendarItem,
} from "../src/shared/types";

describe("RFC 5545 ICS Parser & Generator", () => {
  it("parses folded Moodle ICS with Hebrew summaries, categories, and Moodle event ID", () => {
    const raw = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Moodle Pty Ltd//NONSGML Moodle Version 2026//EN",
      "BEGIN:VEVENT",
      "UID:14822@moodle.tau.ac.il/2026",
      "SUMMARY:תרגיל בית 3 - רדוקציות ",
      " וגרפים - יש להגיש",
      "DESCRIPTION:הגשה בקובץ PDF\\nקישור: https://moodle.tau.ac.il/2026/mod/assign/view.php?id=910",
      "DTSTART:20261130T215900Z",
      "DTEND:20261130T215900Z",
      "CATEGORIES:0368-2158-01",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsed = parseIcs(raw);
    expect(parsed.events).toHaveLength(1);
    const ev = parsed.events[0];
    expect(ev.uid).toBe("14822@moodle.tau.ac.il/2026");
    expect(ev.moodleEventId).toBe(14822);
    expect(ev.summary).toBe("תרגיל בית 3 - רדוקציות וגרפים - יש להגיש");
    expect(ev.description).toContain("הגשה בקובץ PDF\nקישור:");
    expect(ev.categories).toEqual(["0368-2158-01"]);
    expect(ev.url).toBe("https://moodle.tau.ac.il/2026/mod/assign/view.php?id=910");
    expect(ev.dtstart).toBe("2026-11-30T21:59:00.000Z");
  });

  it("folds UTF-8 Hebrew & emoji lines strictly at <=75 bytes without corrupting characters", () => {
    const line =
      "SUMMARY:✅ [מבוא לאלגוריתמים ותכנות דינמי] תרגיל בית 4 — הושלם והוגש בזמן במודל אוניברסיטת תל אביב";
    const folded = foldIcsLine(line);
    const enc = new TextEncoder();

    for (const part of folded.split("\r\n")) {
      expect(enc.encode(part).length).toBeLessThanOrEqual(75);
      // Verify valid UTF-8 roundtrip (no broken surrogates)
      expect(part).not.toContain("\uFFFD");
    }

    expect(unfoldIcsLines(folded)).toEqual([line]);
  });

  it("generates ICS with completion status, expanded deadline window, and muted reminders for completed problem sets", () => {
    const baseItem: EnrichedCalendarItem = {
      uid: "1001@moodle.tau.ac.il/2026",
      moodleEventId: 1001,
      courseKey: "0368-2158-01",
      summary: "HW 1",
      description: "Solve Q1-Q4",
      location: null,
      dtstart: "2026-12-01T21:59:00.000Z",
      dtend: "2026-12-01T21:59:00.000Z",
      isAllDay: false,
      lastModified: "2026-11-23T00:00:00.000Z",
      modulename: "assign",
      eventtype: "due",
      moodleUrl: "https://moodle.tau.ac.il/2026/mod/assign/view.php?id=1",
      isProblemSetAuto: true,
      isProblemSetManual: null,
      moodleStatus: "submitted",
      moodleStatusDetail: null,
      moodleStatusUpdatedAt: "2026-11-23T00:00:00.000Z",
      manualStatus: null,
      manualStatusUpdatedAt: null,
      note: null,
      inLiveFeed: true,
      updatedAt: "2026-11-23T00:00:00.000Z",
      isProblemSet: true,
      effectiveStatus: "completed",
      statusSource: "moodle",
      isOverdue: false,
      courseDisplayName: "Algorithms",
      courseVisible: true,
      formattedSummary: "✅ [Algorithms] HW 1 — Completed",
      formattedDescription: "Status: ✅ Completed (Submitted on Moodle)",
    };

    const pendingItem: EnrichedCalendarItem = {
      ...baseItem,
      uid: "1002@moodle.tau.ac.il/2026",
      moodleEventId: 1002,
      summary: "HW 2",
      moodleStatus: "not_submitted",
      effectiveStatus: "not_completed",
      formattedSummary: "⬜ [Algorithms] HW 2 — Not Completed",
      formattedDescription: "Status: ⬜ Not Completed",
    };

    const ics = generateIcs([baseItem, pendingItem], DEFAULT_WORKSPACE_SETTINGS);

    // Completed item has TRANSP:TRANSPARENT and ZERO VALARMs
    const blocks = ics.split("BEGIN:VEVENT").slice(1);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("X-TAU-COMPLETION-STATUS:COMPLETED");
    expect(blocks[0]).toContain("TRANSP:TRANSPARENT");
    expect(blocks[0]).not.toContain("BEGIN:VALARM");
    // 30-minute display block ending at 21:59 -> starts at 21:29
    expect(blocks[0]).toContain("DTSTART:20261201T212900Z");
    expect(blocks[0]).toContain("DTEND:20261201T215900Z");

    // Pending item has TRANSP:OPAQUE and 2 VALARMs (24h and 2h)
    expect(blocks[1]).toContain("X-TAU-COMPLETION-STATUS:NOT_COMPLETED");
    expect(blocks[1]).toContain("TRANSP:OPAQUE");
    expect(blocks[1]).toContain("TRIGGER:-P1D");
    expect(blocks[1]).toContain("TRIGGER:-PT2H");

    // Round-trip parse confirms both titles survive folding/escaping intact
    const reparsed = parseIcs(ics);
    expect(reparsed.events[0].summary).toBe("✅ [Algorithms] HW 1 — Completed");
    expect(reparsed.events[1].summary).toBe("⬜ [Algorithms] HW 2 — Not Completed");
  });
});
