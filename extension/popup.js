const appOriginEl = document.getElementById("appOrigin");
const tokenEl = document.getElementById("dashboardToken");
const statusBox = document.getElementById("statusBox");
const openDashboardLink = document.getElementById("openDashboard");

async function loadState() {
  const data = await chrome.storage.local.get([
    "appOrigin",
    "dashboardToken",
    "lastSyncResult",
  ]);
  appOriginEl.value = data.appOrigin || "http://localhost:5173";
  tokenEl.value = data.dashboardToken || "";
  updateDashboardLink();

  if (data.lastSyncResult && data.lastSyncResult.stats) {
    const s = data.lastSyncResult.stats;
    statusBox.textContent = `Last sync: ${s.completedCount}/${s.totalProblemSets} completed (${s.overdueCount} overdue)`;
  }
}

function updateDashboardLink() {
  const origin = appOriginEl.value.trim().replace(/\/+$/, "");
  const token = tokenEl.value.trim();
  if (origin && token) {
    openDashboardLink.href = `${origin}/w/${encodeURIComponent(token)}`;
    openDashboardLink.style.display = "inline";
  } else {
    openDashboardLink.style.display = "none";
  }
}

document.getElementById("saveBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({
    appOrigin: appOriginEl.value.trim().replace(/\/+$/, ""),
    dashboardToken: tokenEl.value.trim(),
  });
  updateDashboardLink();
  statusBox.textContent = "Saved! Visit moodle.tau.ac.il to auto-sync.";
});

document.getElementById("syncBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({
    appOrigin: appOriginEl.value.trim().replace(/\/+$/, ""),
    dashboardToken: tokenEl.value.trim(),
  });
  updateDashboardLink();
  statusBox.textContent = "Syncing from TAU Moodle...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url || !tab.url.includes("moodle.tau.ac.il")) {
    statusBox.textContent = "Open a logged-in moodle.tau.ac.il tab first!";
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "SYNC_NOW" }, (res) => {
    if (chrome.runtime.lastError) {
      statusBox.textContent = "Reload the TAU Moodle tab and try again.";
      return;
    }
    if (res && res.ok) {
      const s = res.stats || {};
      statusBox.textContent = `Synced! ${s.completedCount ?? 0}/${s.totalProblemSets ?? 0} problem sets completed.`;
    } else {
      statusBox.textContent = "Sync error: " + ((res && res.error) || "Unknown");
    }
  });
});

loadState();
