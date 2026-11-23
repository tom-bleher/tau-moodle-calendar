import { describe, expect, it } from "vitest";
import { generateGoogleAppsScript } from "../src/shared/apps-script";
import {
  formatCalendarDescription,
  formatCalendarSummary,
} from "../src/shared/formatting";
import { buildBookmarkletHref } from "../src/shared/moodle-sync-script";
import { DEFAULT_WORKSPACE_SETTINGS } from "../src/shared/types";
import { validateMoodleExportUrl } from "../src/worker/moodle-fetcher";

describe("Calendar Formatting, Generators & Security Validation", () => {
  const sample = {
    uid: "123@moodle.tau.ac.il/2026",
    summary: "תרגיל בית 2 - יש להגיש",
    description: "Submit PDF on Moodle",
    isProblemSet: true,
    effectiveStatus: "completed" as const,
    moodleStatus: "submitted" as const,
    moodleStatusDetail: null,
    statusSource: "moodle" as const,
    isOverdue: false,
    courseDisplayName: "אלגוריתמים",
    courseShortname: "0368-2158-01",
    moodleUrl: "https://moodle.tau.ac.il/2026/mod/assign/view.php?id=9",
    note: "Pair with Dana",
    dashboardUrl: "https://example.com/w/tok#item=123",
  };

  it("formats summaries in explicit, compact, text, and Hebrew modes", () => {
    expect(formatCalendarSummary(sample, DEFAULT_WORKSPACE_SETTINGS)).toBe(
      "✅ [אלגוריתמים] תרגיל בית 2 — Completed"
    );

    expect(
      formatCalendarSummary(sample, {
        ...DEFAULT_WORKSPACE_SETTINGS,
        labelLang: "he",
      })
    ).toBe("✅ [אלגוריתמים] תרגיל בית 2 — הושלם");

    expect(
      formatCalendarSummary(
        { ...sample, effectiveStatus: "not_completed", isOverdue: true },
        { ...DEFAULT_WORKSPACE_SETTINGS, titleStyle: "text" }
      )
    ).toBe("[OVERDUE] [אלגוריתמים] תרגיל בית 2");
  });

  it("includes explicit status, course code, note, and links in description", () => {
    const desc = formatCalendarDescription(sample, DEFAULT_WORKSPACE_SETTINGS);
    expect(desc).toContain("Status: ✅ Completed (Submitted on Moodle)");
    expect(desc).toContain("Course: אלגוריתמים (0368-2158-01)");
    expect(desc).toContain("Note: Pair with Dana");
    expect(desc).toContain("Moodle Link: https://moodle.tau.ac.il/2026/mod/assign/view.php?id=9");
  });

  it("generates valid, syntactically sound Bookmarklet href and Google Apps Script", () => {
    const href = buildBookmarkletHref("https://tau-cal.workers.dev", "tok_123");
    expect(href.startsWith("javascript:")).toBe(true);
    const decoded = decodeURIComponent(href.slice("javascript:".length));
    expect(decoded).toContain("moodle.tau.ac.il");
    expect(decoded).toContain("https://tau-cal.workers.dev/api/w/tok_123/moodle-sync");
    // Verify the minified bookmarklet is 100% syntactically valid JavaScript
    expect(() => new Function(decoded)).not.toThrow();

    const script = generateGoogleAppsScript(
      "https://tau-cal.workers.dev/feed/feed_abc.json",
      "TAU Moodle"
    );
    expect(script).toContain("setupTauMoodleSync");
    expect(script).toContain("https://tau-cal.workers.dev/feed/feed_abc.json");
    expect(script).toContain("CalendarApp.EventColor.GREEN");
    expect(() => new Function(script)).not.toThrow();
  });

  it("blocks SSRF and non-TAU URLs while accepting valid TAU Moodle export URLs", () => {
    const valid = validateMoodleExportUrl(
      "https://moodle.tau.ac.il/2026/calendar/export_execute.php?userid=42&authtoken=abcdef123456&preset_what=all&preset_time=custom"
    );
    expect(valid.moodleBaseUrl).toBe("https://moodle.tau.ac.il/2026");
    expect(valid.isDemo).toBe(false);

    expect(() =>
      validateMoodleExportUrl("http://169.254.169.254/latest/meta-data/")
    ).toThrow();
    expect(() =>
      validateMoodleExportUrl(
        "https://evil.example.com/calendar/export_execute.php?userid=1&authtoken=abc"
      )
    ).toThrow();
    expect(() =>
      validateMoodleExportUrl("https://moodle.tau.ac.il/2026/login/index.php")
    ).toThrow();
  });
});
