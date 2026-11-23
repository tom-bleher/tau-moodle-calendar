import { Hono } from "hono";
import { cors } from "hono/cors";
import { buildDemoTauData } from "../shared/demo-data";
import { generateIcs } from "../shared/ics-generator";
import {
  DEFAULT_WORKSPACE_SETTINGS,
  type CompletionStatus,
  type MoodleSyncPayload,
  type WorkspaceSettings,
} from "../shared/types";
import { encryptText, generateSecureToken } from "./crypto";
import {
  createManualProblemSet,
  createWorkspace,
  deleteWorkspace,
  getWorkspaceByDashboardToken,
  getWorkspaceByFeedToken,
  patchCalendarItem,
  rotateWorkspaceFeedToken,
  updateCoursePreferences,
  updateWorkspaceMoodleUrl,
  updateWorkspaceSettings,
} from "./db";
import { validateMoodleExportUrl } from "./moodle-fetcher";
import {
  applyMoodleBrowserSync,
  buildDashboardResponse,
  buildFeedJsonResponse,
  loadEnrichedItems,
  syncWorkspaceFromLiveIcs,
} from "./sync-engine";

const app = new Hono<{ Bindings: Env }>();

function getEncryptionSecret(env: Env): string {
  const secret = env.ENCRYPTION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "Server configuration error: ENCRYPTION_SECRET must be configured via wrangler secret or .dev.vars."
    );
  }
  return secret;
}

// Allow TAU Moodle bookmarklet & browser extensions to push sync payloads via CORS
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) return "*";
      if (
        origin === "https://moodle.tau.ac.il" ||
        origin.startsWith("chrome-extension://") ||
        origin.startsWith("moz-extension://") ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        return origin;
      }
      return origin;
    },
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  })
);

// Structured error handling (never passThroughOnException)
app.onError((err, c) => {
  const message = err instanceof Error ? err.message : "Internal server error";
  console.error(
    JSON.stringify({
      message: "worker_error",
      path: new URL(c.req.url).pathname,
      method: c.req.method,
      error: message,
    })
  );
  return c.json({ error: message }, 500);
});

app.get("/api/health", (c) => {
  return c.json({
    ok: true,
    service: "tau-moodle-calendar",
    timestamp: new Date().toISOString(),
  });
});

// Create a new workspace (empty, from Moodle export URL, or preloaded realistic TAU demo)
app.post("/api/workspaces", async (c) => {
  const body = await c.req
    .json<{ mode?: "demo" | "empty" | "url"; moodleUrl?: string }>()
    .catch(() => ({} as { mode?: "demo" | "empty" | "url"; moodleUrl?: string }));

  const secret = getEncryptionSecret(c.env);
  const id = crypto.randomUUID();
  const dashboardToken = generateSecureToken(24);
  const feedToken = generateSecureToken(24);
  const origin = new URL(c.req.url).origin;

  if (body.mode === "demo") {
    const encrypted = await encryptText("demo://tau-2026", secret);
    const workspace = await createWorkspace(c.env.DB, {
      id,
      dashboardToken,
      feedToken,
      moodleUrlEncrypted: encrypted,
      moodleBaseUrl: "https://moodle.tau.ac.il/2026",
      isDemo: true,
    });
    const demo = buildDemoTauData();
    await applyMoodleBrowserSync(c.env.DB, workspace, demo.moodleSync, secret);
    const dashboard = await buildDashboardResponse(c.env.DB, workspace, origin);
    return c.json(dashboard, 201);
  }

  let moodleUrlEncrypted: string | null = null;
  let moodleBaseUrl: string | null = null;
  let isDemo = false;

  if (body.moodleUrl && body.moodleUrl.trim()) {
    try {
      const validated = validateMoodleExportUrl(body.moodleUrl);
      moodleUrlEncrypted = await encryptText(validated.normalizedUrl, secret);
      moodleBaseUrl = validated.moodleBaseUrl;
      isDemo = validated.isDemo;
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Invalid Moodle URL" },
        400
      );
    }
  }

  const workspace = await createWorkspace(c.env.DB, {
    id,
    dashboardToken,
    feedToken,
    moodleUrlEncrypted,
    moodleBaseUrl,
    isDemo,
  });

  if (moodleUrlEncrypted) {
    await syncWorkspaceFromLiveIcs(c.env.DB, workspace, secret, { force: true });
  }

  console.log(
    JSON.stringify({
      message: "workspace_created",
      workspaceId: workspace.id,
      hasMoodleUrl: Boolean(moodleUrlEncrypted),
      isDemo,
    })
  );

  const dashboard = await buildDashboardResponse(c.env.DB, workspace, origin);
  return c.json(dashboard, 201);
});

// Get workspace dashboard + problem set tracker data
app.get("/api/w/:token", async (c) => {
  const token = c.req.param("token");
  const workspace = await getWorkspaceByDashboardToken(c.env.DB, token);
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  const refresh = c.req.query("refresh") === "1";
  if (workspace.moodleUrlEncrypted) {
    const secret = getEncryptionSecret(c.env);
    await syncWorkspaceFromLiveIcs(c.env.DB, workspace, secret, {
      force: refresh,
    });
  }

  const origin = new URL(c.req.url).origin;
  const dashboard = await buildDashboardResponse(c.env.DB, workspace, origin);
  return c.json(dashboard);
});

// Force immediate live refresh from TAU Moodle ICS export URL
app.post("/api/w/:token/refresh", async (c) => {
  const token = c.req.param("token");
  const workspace = await getWorkspaceByDashboardToken(c.env.DB, token);
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }
  if (!workspace.moodleUrlEncrypted) {
    return c.json(
      { error: "No Moodle calendar URL connected yet." },
      400
    );
  }

  const secret = getEncryptionSecret(c.env);
  const result = await syncWorkspaceFromLiveIcs(c.env.DB, workspace, secret, {
    force: true,
  });
  const origin = new URL(c.req.url).origin;
  const dashboard = await buildDashboardResponse(c.env.DB, workspace, origin);

  return c.json({
    ...dashboard,
    refreshResult: result,
  });
});

// Connect or update the TAU Moodle ICS export URL
app.post("/api/w/:token/moodle-url", async (c) => {
  const token = c.req.param("token");
  const workspace = await getWorkspaceByDashboardToken(c.env.DB, token);
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  const body = await c.req
    .json<{ moodleUrl?: string }>()
    .catch(() => ({} as { moodleUrl?: string }));
  if (!body.moodleUrl) {
    return c.json({ error: "moodleUrl is required" }, 400);
  }

  let validated;
  try {
    validated = validateMoodleExportUrl(body.moodleUrl);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Invalid Moodle URL" },
      400
    );
  }

  const secret = getEncryptionSecret(c.env);
  const encrypted = await encryptText(validated.normalizedUrl, secret);

  // Clear demo records if switching from demo to a real TAU Moodle link
  if (workspace.isDemo && !validated.isDemo) {
    await c.env.DB.batch([
      c.env.DB
        .prepare("DELETE FROM calendar_items WHERE workspace_id = ?")
        .bind(workspace.id),
      c.env.DB
        .prepare("DELETE FROM courses WHERE workspace_id = ?")
        .bind(workspace.id),
    ]);
  }

  await updateWorkspaceMoodleUrl(
    c.env.DB,
    workspace.id,
    encrypted,
    validated.moodleBaseUrl,
    validated.isDemo
  );
  workspace.moodleUrlEncrypted = encrypted;
  workspace.moodleBaseUrl = validated.moodleBaseUrl;
  workspace.isDemo = validated.isDemo;

  if (validated.isDemo) {
    await applyMoodleBrowserSync(
      c.env.DB,
      workspace,
      buildDemoTauData().moodleSync,
      secret
    );
  } else {
    await syncWorkspaceFromLiveIcs(c.env.DB, workspace, secret, { force: true });
  }

  const origin = new URL(c.req.url).origin;
  const dashboard = await buildDashboardResponse(c.env.DB, workspace, origin);
  return c.json(dashboard);
});

// Receive authenticated sync snapshot from the TAU Moodle Bookmarklet or Browser Extension
app.post("/api/w/:token/moodle-sync", async (c) => {
  const token = c.req.param("token");
  const workspace = await getWorkspaceByDashboardToken(c.env.DB, token);
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  const payload = await c.req
    .json<MoodleSyncPayload>()
    .catch(() => null);
  if (!payload || typeof payload !== "object") {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  if (payload.exportUrl) {
    try {
      validateMoodleExportUrl(payload.exportUrl);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Invalid exportUrl" },
        400
      );
    }
  }

  const secret = getEncryptionSecret(c.env);
  await applyMoodleBrowserSync(c.env.DB, workspace, payload, secret);

  console.log(
    JSON.stringify({
      message: "moodle_browser_sync",
      workspaceId: workspace.id,
      eventsReceived: payload.events?.length ?? 0,
      coursesReceived: payload.courses?.length ?? 0,
      hasExportUrl: Boolean(payload.exportUrl),
    })
  );

  const origin = new URL(c.req.url).origin;
  const dashboard = await buildDashboardResponse(c.env.DB, workspace, origin);
  return c.json(dashboard);
});

// Toggle problem set completion status, classification, or personal note
app.patch("/api/w/:token/items/:uid", async (c) => {
  const token = c.req.param("token");
  const uid = decodeURIComponent(c.req.param("uid"));
  const workspace = await getWorkspaceByDashboardToken(c.env.DB, token);
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  const body = await c.req
    .json<{
      manualStatus?: CompletionStatus | null;
      isProblemSetManual?: boolean | null;
      note?: string | null;
    }>()
    .catch(() => null);

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const validStatuses = new Set(["completed", "in_progress", "not_completed"]);
  if (
    body.manualStatus !== undefined &&
    body.manualStatus !== null &&
    !validStatuses.has(body.manualStatus)
  ) {
    return c.json({ error: "Invalid manualStatus value" }, 400);
  }

  const updated = await patchCalendarItem(c.env.DB, workspace.id, uid, body);
  if (!updated) {
    return c.json({ error: "Calendar item not found" }, 404);
  }

  const origin = new URL(c.req.url).origin;
  const dashboard = await buildDashboardResponse(c.env.DB, workspace, origin);
  return c.json(dashboard);
});

// Add a custom manual problem set (e.g., paper/Gradescope HW not listed on Moodle)
app.post("/api/w/:token/items/manual", async (c) => {
  const token = c.req.param("token");
  const workspace = await getWorkspaceByDashboardToken(c.env.DB, token);
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  const body = await c.req
    .json<{
      summary?: string;
      courseKey?: string | null;
      dueIso?: string;
      description?: string;
      moodleUrl?: string | null;
      status?: CompletionStatus;
    }>()
    .catch(() => null);

  if (!body || !body.summary?.trim() || !body.dueIso) {
    return c.json({ error: "summary and dueIso are required" }, 400);
  }
  const dueDate = new Date(body.dueIso);
  if (Number.isNaN(dueDate.getTime())) {
    return c.json({ error: "Invalid dueIso date" }, 400);
  }

  const uid = `manual-${crypto.randomUUID()}@tau-moodle-calendar`;
  await createManualProblemSet(c.env.DB, workspace.id, {
    uid,
    summary: body.summary.trim(),
    courseKey: body.courseKey?.trim() || null,
    dueIso: dueDate.toISOString(),
    description: body.description?.trim() || "",
    moodleUrl: body.moodleUrl?.trim() || null,
    status: body.status ?? "not_completed",
  });

  const origin = new URL(c.req.url).origin;
  const dashboard = await buildDashboardResponse(c.env.DB, workspace, origin);
  return c.json(dashboard, 201);
});

// Update course display alias, visibility, or color
app.patch("/api/w/:token/courses/:courseKey", async (c) => {
  const token = c.req.param("token");
  const courseKey = decodeURIComponent(c.req.param("courseKey"));
  const workspace = await getWorkspaceByDashboardToken(c.env.DB, token);
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  const body = await c.req
    .json<{
      customName?: string | null;
      visible?: boolean;
      color?: string | null;
    }>()
    .catch(() => null);

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const updated = await updateCoursePreferences(
    c.env.DB,
    workspace.id,
    courseKey,
    body
  );
  if (!updated) {
    return c.json({ error: "Course not found" }, 404);
  }

  const origin = new URL(c.req.url).origin;
  const dashboard = await buildDashboardResponse(c.env.DB, workspace, origin);
  return c.json(dashboard);
});

// Update calendar formatting & reminder settings
app.patch("/api/w/:token/settings", async (c) => {
  const token = c.req.param("token");
  const workspace = await getWorkspaceByDashboardToken(c.env.DB, token);
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  const patch = await c.req
    .json<Partial<WorkspaceSettings>>()
    .catch(() => null);
  if (!patch) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const merged: WorkspaceSettings = {
    ...DEFAULT_WORKSPACE_SETTINGS,
    ...workspace.settings,
    ...patch,
    calendarName:
      typeof patch.calendarName === "string" && patch.calendarName.trim()
        ? patch.calendarName.trim().slice(0, 64)
        : workspace.settings.calendarName,
    deadlineDurationMinutes:
      typeof patch.deadlineDurationMinutes === "number" &&
      patch.deadlineDurationMinutes >= 0 &&
      patch.deadlineDurationMinutes <= 240
        ? Math.round(patch.deadlineDurationMinutes)
        : workspace.settings.deadlineDurationMinutes,
    reminderMinutes: Array.isArray(patch.reminderMinutes)
      ? patch.reminderMinutes
          .map(Number)
          .filter((n) => Number.isFinite(n) && n >= 0 && n <= 40320)
          .slice(0, 5)
      : workspace.settings.reminderMinutes,
  };

  await updateWorkspaceSettings(c.env.DB, workspace.id, merged);
  workspace.settings = merged;

  const origin = new URL(c.req.url).origin;
  const dashboard = await buildDashboardResponse(c.env.DB, workspace, origin);
  return c.json(dashboard);
});

// Rotate read-only feed token
app.post("/api/w/:token/rotate-feed-token", async (c) => {
  const token = c.req.param("token");
  const workspace = await getWorkspaceByDashboardToken(c.env.DB, token);
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  const newFeedToken = generateSecureToken(24);
  await rotateWorkspaceFeedToken(c.env.DB, workspace.id, newFeedToken);
  workspace.feedToken = newFeedToken;

  const origin = new URL(c.req.url).origin;
  const dashboard = await buildDashboardResponse(c.env.DB, workspace, origin);
  return c.json(dashboard);
});

// Permanently delete workspace
app.delete("/api/w/:token", async (c) => {
  const token = c.req.param("token");
  const workspace = await getWorkspaceByDashboardToken(c.env.DB, token);
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }
  await deleteWorkspace(c.env.DB, workspace.id);
  return c.json({ deleted: true });
});

// Live RFC 5545 iCalendar (.ics) subscription endpoint for Apple Calendar & Google Calendar
app.get("/feed/:feedFile", async (c) => {
  const feedFile = c.req.param("feedFile");

  if (feedFile.endsWith(".ics")) {
    const feedToken = feedFile.slice(0, -4);
    const workspace = await getWorkspaceByFeedToken(c.env.DB, feedToken);
    if (!workspace) {
      return c.text("Calendar feed not found", 404);
    }

    if (workspace.moodleUrlEncrypted) {
      const secret = getEncryptionSecret(c.env);
      await syncWorkspaceFromLiveIcs(c.env.DB, workspace, secret, {
        force: c.req.query("refresh") === "1",
      });
    }

    const origin = new URL(c.req.url).origin;
    const { items } = await loadEnrichedItems(c.env.DB, workspace, origin);
    const statusParam = c.req.query("status");
    const filterStatus =
      statusParam === "incomplete" || statusParam === "completed"
        ? statusParam
        : "all";

    const ics = generateIcs(items, workspace.settings, { filterStatus });
    const isDownload = c.req.query("download") === "1";

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="tau-moodle.ics"`,
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (feedFile.endsWith(".json")) {
    const feedToken = feedFile.slice(0, -5);
    const workspace = await getWorkspaceByFeedToken(c.env.DB, feedToken);
    if (!workspace) {
      return c.json({ error: "Calendar feed not found" }, 404);
    }

    if (workspace.moodleUrlEncrypted) {
      const secret = getEncryptionSecret(c.env);
      await syncWorkspaceFromLiveIcs(c.env.DB, workspace, secret, {
        force: c.req.query("refresh") === "1",
      });
    }

    const origin = new URL(c.req.url).origin;
    const { items } = await loadEnrichedItems(c.env.DB, workspace, origin);
    const payload = buildFeedJsonResponse(workspace, items);

    return c.json(payload, 200, {
      "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
    });
  }

  return c.text("Unsupported feed format. Use .ics or .json", 404);
});

// Delegate all remaining paths to Static Assets SPA
app.all("*", async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text("Not Found", 404);
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return Promise.resolve(app.fetch(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;
