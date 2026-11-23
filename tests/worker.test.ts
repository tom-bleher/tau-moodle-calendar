import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { parseIcs } from "../src/shared/ics-parser";
import type {
  FeedJsonResponse,
  WorkspaceDashboardResponse,
} from "../src/shared/types";

describe("TAU Moodle Calendar Worker API & Feeds (End-to-End with D1)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  it("creates a demo workspace, reflects live completion toggles in both .ics and .json feeds, and enforces security", async () => {
    // 1. Health check
    const healthRes = await SELF.fetch("https://example.com/api/health");
    expect(healthRes.status).toBe(200);

    // 2. Create demo workspace
    const createRes = await SELF.fetch("https://example.com/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "demo" }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as WorkspaceDashboardResponse;

    expect(created.workspace.isDemo).toBe(true);
    expect(created.stats.totalProblemSets).toBe(8);
    expect(created.stats.completedCount).toBe(3);
    expect(created.stats.inProgressCount).toBe(1);
    expect(created.stats.overdueCount).toBe(1);

    const { dashboardToken, feedToken } = created.workspace;

    // 3. Fetch live .ics feed for Apple/Google Calendar
    const icsRes = await SELF.fetch(
      `https://example.com/feed/${feedToken}.ics`
    );
    expect(icsRes.status).toBe(200);
    expect(icsRes.headers.get("Content-Type")).toContain("text/calendar");
    const icsText = await icsRes.text();
    const parsedIcs = parseIcs(icsText);
    expect(parsedIcs.events.length).toBe(10); // 8 problem sets + 2 lectures/recitations

    const overdueEv = parsedIcs.events.find((e) => e.moodleEventId === 80103);
    expect(overdueEv?.summary).toContain("🔴");
    expect(overdueEv?.summary).toContain("Overdue");

    const gradedEv = parsedIcs.events.find((e) => e.moodleEventId === 80101);
    expect(gradedEv?.summary).toContain("✅");
    expect(gradedEv?.summary).toContain("Completed");

    // 4. Toggle overdue problem set 80103 to "completed"
    const targetItem = created.items.find((i) => i.moodleEventId === 80103)!;
    const toggleRes = await SELF.fetch(
      `https://example.com/api/w/${dashboardToken}/items/${encodeURIComponent(targetItem.uid)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manualStatus: "completed",
          note: "Submitted late with TA approval",
        }),
      }
    );
    expect(toggleRes.status).toBe(200);
    const afterToggle = (await toggleRes.json()) as WorkspaceDashboardResponse;
    expect(afterToggle.stats.completedCount).toBe(4);
    expect(afterToggle.stats.overdueCount).toBe(0);

    // 5. Verify BOTH .ics and .json feeds immediately reflect the new Completed state
    const icsRes2 = await SELF.fetch(
      `https://example.com/feed/${feedToken}.ics`
    );
    const parsedIcs2 = parseIcs(await icsRes2.text());
    const updatedEv = parsedIcs2.events.find((e) => e.moodleEventId === 80103);
    expect(updatedEv?.summary).toContain("✅");
    expect(updatedEv?.summary).toContain("Completed");
    expect(updatedEv?.description).toContain("Submitted late with TA approval");

    const jsonRes = await SELF.fetch(
      `https://example.com/feed/${feedToken}.json`
    );
    expect(jsonRes.status).toBe(200);
    const feedJson = (await jsonRes.json()) as FeedJsonResponse;
    const updatedJsonEv = feedJson.events.find((e) => e.uid === targetItem.uid);
    expect(updatedJsonEv?.status).toBe("completed");
    expect(updatedJsonEv?.googleColor).toBe("GREEN");
    expect(updatedJsonEv?.reminderMinutes).toEqual([]); // reminders auto-muted!

    // 6. Test incomplete-only filtered feed
    const incompleteRes = await SELF.fetch(
      `https://example.com/feed/${feedToken}.ics?status=incomplete`
    );
    const incompleteParsed = parseIcs(await incompleteRes.text());
    expect(incompleteParsed.events.length).toBe(4); // 8 total - 4 completed

    // 7. Add custom manual problem set (e.g. Gradescope HW)
    const manualRes = await SELF.fetch(
      `https://example.com/api/w/${dashboardToken}/items/manual`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: "Gradescope HW 7",
          courseKey: "0368-3065-01",
          dueIso: "2026-12-15T21:59:00.000Z",
          status: "not_completed",
        }),
      }
    );
    expect(manualRes.status).toBe(201);
    const afterManual = (await manualRes.json()) as WorkspaceDashboardResponse;
    expect(afterManual.stats.totalProblemSets).toBe(9);

    // 8. Push a Moodle browser sync payload updating a pending HW to "submitted"
    const syncRes = await SELF.fetch(
      `https://example.com/api/w/${dashboardToken}/moodle-sync`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [
            {
              eventId: 80105,
              name: "תרגיל בית 2 - תכנות דינמי וזרימה ברשתות - יש להגיש",
              modulename: "assign",
              eventtype: "due",
              timestart: Math.floor(Date.now() / 1000) + 3 * 86400,
              timeduration: 0,
              courseShortname: "0368-2158-01",
              courseFullname: "מבוא לאלגוריתמים",
              moodleStatus: "submitted",
              moodleStatusDetail: "Submitted for grading",
            },
          ],
        }),
      }
    );
    expect(syncRes.status).toBe(200);
    const afterSync = (await syncRes.json()) as WorkspaceDashboardResponse;
    const syncedItem = afterSync.items.find((i) => i.moodleEventId === 80105);
    expect(syncedItem?.effectiveStatus).toBe("completed");
    expect(syncedItem?.statusSource).toBe("moodle");

    // 9. Update calendar formatting to Hebrew labels
    const settingsRes = await SELF.fetch(
      `https://example.com/api/w/${dashboardToken}/settings`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labelLang: "he" }),
      }
    );
    expect(settingsRes.status).toBe(200);
    const heIcsRes = await SELF.fetch(
      `https://example.com/feed/${feedToken}.ics`
    );
    expect(await heIcsRes.text()).toContain("הושלם");

    // 10. Rotate feed token — old token stops working, new token works
    const rotRes = await SELF.fetch(
      `https://example.com/api/w/${dashboardToken}/rotate-feed-token`,
      { method: "POST" }
    );
    expect(rotRes.status).toBe(200);
    const rotated = (await rotRes.json()) as WorkspaceDashboardResponse;
    const newFeedToken = rotated.workspace.feedToken;
    expect(newFeedToken).not.toBe(feedToken);

    const oldFeedRes = await SELF.fetch(
      `https://example.com/feed/${feedToken}.ics`
    );
    expect(oldFeedRes.status).toBe(404);

    const newFeedRes = await SELF.fetch(
      `https://example.com/feed/${newFeedToken}.ics`
    );
    expect(newFeedRes.status).toBe(200);

    // 11. Reject SSRF URLs on moodle-url endpoint
    const ssrfRes = await SELF.fetch(
      `https://example.com/api/w/${dashboardToken}/moodle-url`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moodleUrl: "https://evil.com/export_execute.php?userid=1&authtoken=x" }),
      }
    );
    expect(ssrfRes.status).toBe(400);

    // 12. Delete workspace
    const delRes = await SELF.fetch(
      `https://example.com/api/w/${dashboardToken}`,
      { method: "DELETE" }
    );
    expect(delRes.status).toBe(200);
    const goneRes = await SELF.fetch(
      `https://example.com/api/w/${dashboardToken}`
    );
    expect(goneRes.status).toBe(404);
  });
});
