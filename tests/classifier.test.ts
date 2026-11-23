import { describe, expect, it } from "vitest";
import {
  classifyIsProblemSet,
  resolveEffectiveStatus,
} from "../src/shared/classifier";

describe("TAU Problem Set Classifier & Status Resolution", () => {
  it("distinguishes Hebrew homework from recitation classes and lectures", () => {
    expect(
      classifyIsProblemSet({ summary: "תרגיל בית 3 - רדוקציות - יש להגיש" })
    ).toBe(true);
    expect(classifyIsProblemSet({ summary: "מטלה 2 - מבני נתונים" })).toBe(true);
    expect(classifyIsProblemSet({ summary: "בוחן מקוון 1" })).toBe(true);
    expect(classifyIsProblemSet({ summary: "Problem Set 4 is due" })).toBe(true);
    expect(classifyIsProblemSet({ summary: "HW 5" })).toBe(true);

    // Recitations & lectures must NOT be classified as problem sets
    expect(classifyIsProblemSet({ summary: "תרגול 5 - עצי אדום-שחור" })).toBe(
      false
    );
    expect(classifyIsProblemSet({ summary: "הרצאה 7 - אלגוריתמי קירוב" })).toBe(
      false
    );
    expect(classifyIsProblemSet({ summary: "Office Hours (Zoom)" })).toBe(false);
  });

  it("prioritizes Moodle modulename metadata", () => {
    expect(
      classifyIsProblemSet({
        summary: "Bonus Challenge",
        modulename: "assign",
        eventtype: "due",
      })
    ).toBe(true);
    expect(
      classifyIsProblemSet({
        summary: "Assignment opens",
        modulename: "assign",
        eventtype: "open",
      })
    ).toBe(false);
  });

  it("resolves completion precedence and overdue state accurately", () => {
    const past = "2026-11-10T21:59:00.000Z";
    const future = "2026-12-10T21:59:00.000Z";
    const now = Date.parse("2026-11-23T12:00:00.000Z");

    // Past & unsubmitted -> overdue
    const r1 = resolveEffectiveStatus(
      {
        manualStatus: null,
        manualStatusUpdatedAt: null,
        moodleStatus: "not_submitted",
        moodleStatusUpdatedAt: "2026-11-20T00:00:00.000Z",
        dtstart: past,
        dtend: past,
      },
      true,
      now
    );
    expect(r1).toEqual({
      effectiveStatus: "not_completed",
      statusSource: "moodle",
      isOverdue: true,
    });

    // Manual completed overrides Moodle not_submitted (e.g. submitted on paper / Gradescope)
    const r2 = resolveEffectiveStatus(
      {
        manualStatus: "completed",
        manualStatusUpdatedAt: "2026-11-21T00:00:00.000Z",
        moodleStatus: "not_submitted",
        moodleStatusUpdatedAt: "2026-11-22T00:00:00.000Z",
        dtstart: past,
        dtend: past,
      },
      true,
      now
    );
    expect(r2).toEqual({
      effectiveStatus: "completed",
      statusSource: "manual",
      isOverdue: false,
    });

    // Newer Moodle submission auto-upgrades an older manual "in_progress" to completed
    const r3 = resolveEffectiveStatus(
      {
        manualStatus: "in_progress",
        manualStatusUpdatedAt: "2026-11-20T00:00:00.000Z",
        moodleStatus: "submitted",
        moodleStatusUpdatedAt: "2026-11-22T15:00:00.000Z",
        dtstart: future,
        dtend: future,
      },
      true,
      now
    );
    expect(r3).toEqual({
      effectiveStatus: "completed",
      statusSource: "moodle",
      isOverdue: false,
    });
  });
});
