chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "PUSH_MOODLE_SYNC") return;

  (async () => {
    const { appOrigin, dashboardToken } = await chrome.storage.local.get([
      "appOrigin",
      "dashboardToken",
    ]);
    if (!appOrigin || !dashboardToken) {
      sendResponse({
        ok: false,
        error: "Extension not configured yet. Open popup to enter your workspace token.",
      });
      return;
    }

    const endpoint = `${appOrigin.replace(/\/+$/, "")}/api/w/${encodeURIComponent(
      dashboardToken
    )}/moodle-sync`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      sendResponse({
        ok: false,
        error: errData.error || `HTTP ${res.status}`,
      });
      return;
    }

    const data = await res.json();
    const pending =
      (data.stats?.notCompletedCount || 0) + (data.stats?.inProgressCount || 0);

    await chrome.action.setBadgeText({
      text: pending > 0 ? String(pending) : "",
    });
    await chrome.action.setBadgeBackgroundColor({
      color: data.stats?.overdueCount > 0 ? "#DC2626" : "#0F294A",
    });

    await chrome.storage.local.set({
      lastSyncResult: {
        syncedAt: new Date().toISOString(),
        stats: data.stats,
      },
    });

    sendResponse({ ok: true, stats: data.stats });
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err) });
  });

  return true;
});
