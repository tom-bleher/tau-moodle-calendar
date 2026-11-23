// Runs inside authenticated moodle.tau.ac.il tabs — never touches or reads TAU passwords.
(function () {
  const MIN_AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes throttle on passive visits

  function getBaseUrl() {
    const yearMatch = location.pathname.match(/^\/(\d{4})/);
    return location.origin + (yearMatch ? "/" + yearMatch[1] : "");
  }

  function findSesskey() {
    const inp = document.querySelector('input[name="sesskey"]');
    if (inp && inp.value) return inp.value;
    const links = document.querySelectorAll('a[href*="sesskey="]');
    for (const a of links) {
      const m = /sesskey=([A-Za-z0-9]+)/.exec(a.getAttribute("href") || "");
      if (m) return m[1];
    }
    const scripts = document.querySelectorAll("script");
    for (const s of scripts) {
      const m = /"sesskey"\s*:\s*"([A-Za-z0-9]+)"/.exec(s.textContent || "");
      if (m) return m[1];
    }
    return "";
  }

  async function collectMoodleData() {
    const baseUrl = getBaseUrl();
    let sesskey = findSesskey();
    if (!sesskey) {
      return null; // Not logged in yet (e.g. login page)
    }

    // 1. Extract Moodle calendar export URL
    let exportUrl = "";
    try {
      const exportPageRes = await fetch(baseUrl + "/calendar/export.php", {
        credentials: "include",
      });
      const exportHtml = await exportPageRes.text();
      const doc = new DOMParser().parseFromString(exportHtml, "text/html");
      const form =
        doc.querySelector('form[action*="export.php"]') ||
        doc.querySelector("form.mform");
      if (form) {
        const fd = new URLSearchParams();
        form.querySelectorAll('input[type="hidden"]').forEach((el) => {
          if (el.name) fd.set(el.name, el.value);
        });
        fd.set("events[exportevents]", "all");
        const hasCustom = !!form.querySelector(
          'input[name="period[timeperiod]"][value="custom"]'
        );
        fd.set("period[timeperiod]", hasCustom ? "custom" : "recentupcoming");
        fd.set("generateurl", "Get calendar URL");

        const postRes = await fetch(baseUrl + "/calendar/export.php", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: fd.toString(),
        });
        const postHtml = await postRes.text();
        const urlMatch = postHtml.match(
          /https?:\/\/[^"'<>\s]+calendar\/export_execute\.php\?[^"'<>\s]+/i
        );
        if (urlMatch) {
          exportUrl = urlMatch[0].replace(/&amp;/g, "&");
        }
      }
    } catch (_) {}

    // 2. Query Moodle's authenticated AJAX calendar services
    const now = new Date();
    const ajaxCalls = [];
    for (let offset = -1; offset <= 4; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      ajaxCalls.push({
        index: ajaxCalls.length,
        methodname: "core_calendar_get_calendar_monthly_view",
        args: {
          year: d.getFullYear(),
          month: d.getMonth() + 1,
          courseid: 1,
          mini: false,
        },
      });
    }
    ajaxCalls.push({
      index: ajaxCalls.length,
      methodname: "core_calendar_get_action_events_by_timesort",
      args: {
        timesortfrom: Math.floor(Date.now() / 1000) - 60 * 86400,
        limitnum: 50,
      },
    });

    const coursesMap = new Map();
    const eventsMap = new Map();
    const pendingActionIds = new Set();
    const hostAddress = baseUrl.replace(/^https?:\/\//, "");

    const ajaxRes = await fetch(
      baseUrl + "/lib/ajax/service.php?sesskey=" + encodeURIComponent(sesskey),
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ajaxCalls),
      }
    );
    const ajaxData = await ajaxRes.json();

    if (Array.isArray(ajaxData)) {
      const last = ajaxData[ajaxData.length - 1];
      if (last && !last.error && last.data && Array.isArray(last.data.events)) {
        for (const ev of last.data.events) pendingActionIds.add(ev.id);
      }

      for (let i = 0; i < ajaxData.length - 1; i++) {
        const item = ajaxData[i];
        if (!item || item.error || !item.data || !Array.isArray(item.data.weeks))
          continue;
        for (const week of item.data.weeks) {
          for (const day of week.days || []) {
            for (const ev of day.events || []) {
              if (ev.course && ev.course.shortname) {
                coursesMap.set(ev.course.shortname, {
                  id: ev.course.id,
                  shortname: ev.course.shortname,
                  fullname: ev.course.fullname || ev.course.shortname,
                });
              }
              const mod = ev.modulename || null;
              const evType = ev.eventtype || null;
              let initialStatus = "unknown";
              if (mod === "assign" && evType === "due") {
                initialStatus =
                  ev.isactionevent || pendingActionIds.has(ev.id)
                    ? "not_submitted"
                    : "submitted";
              } else if (
                mod === "quiz" &&
                (evType === "close" || evType === "due")
              ) {
                if (ev.isactionevent || pendingActionIds.has(ev.id)) {
                  initialStatus = "not_submitted";
                }
              }

              eventsMap.set(ev.id, {
                eventId: ev.id,
                uid: ev.id + "@" + hostAddress,
                name: ev.name || "",
                description: (ev.description || "")
                  .replace(/<[^>]+>/g, " ")
                  .replace(/\s+/g, " ")
                  .trim(),
                modulename: mod,
                eventtype: evType,
                timestart: ev.timestart,
                timeduration: ev.timeduration || 0,
                courseShortname: ev.course ? ev.course.shortname : undefined,
                courseFullname: ev.course ? ev.course.fullname : undefined,
                courseId: ev.course ? ev.course.id : undefined,
                url: ev.url || (ev.action && ev.action.url) || null,
                moodleStatus: initialStatus,
                moodleStatusDetail: null,
              });
            }
          }
        }
      }
    }

    // 3. Verify exact submission status on assignment & quiz pages
    const verifiable = Array.from(eventsMap.values())
      .filter(
        (e) => e.url && (e.modulename === "assign" || e.modulename === "quiz")
      )
      .slice(0, 30);

    let idx = 0;
    const worker = async () => {
      while (idx < verifiable.length) {
        const ev = verifiable[idx++];
        try {
          const res = await fetch(ev.url, { credentials: "include" });
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, "text/html");
          if (ev.modulename === "assign") {
            if (doc.querySelector(".submissiongraded")) {
              ev.moodleStatus = "graded";
              ev.moodleStatusDetail =
                doc.querySelector(".submissiongraded")?.textContent?.trim() ||
                null;
            } else if (doc.querySelector(".submissionstatussubmitted")) {
              ev.moodleStatus = "submitted";
              ev.moodleStatusDetail =
                doc
                  .querySelector(".submissionstatussubmitted")
                  ?.textContent?.trim() || null;
            } else if (doc.querySelector(".submissionstatusdraft")) {
              ev.moodleStatus = "draft";
              ev.moodleStatusDetail =
                doc
                  .querySelector(".submissionstatusdraft")
                  ?.textContent?.trim() || null;
            } else if (
              doc.querySelector(
                ".submissionstatusnew, .submissionstatusreopened"
              )
            ) {
              ev.moodleStatus = "not_submitted";
            }
          } else if (ev.modulename === "quiz") {
            const summary = doc.querySelector(".quizattemptsummary");
            if (summary) {
              const txt = summary.textContent || "";
              if (/finished|הושלם|נשלח|הוגש/i.test(txt)) {
                ev.moodleStatus = "submitted";
              } else if (/in progress|בתהליך/i.test(txt)) {
                ev.moodleStatus = "draft";
              }
            }
          }
        } catch (_) {}
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    return {
      exportUrl: exportUrl || undefined,
      moodleBaseUrl: baseUrl,
      courses: Array.from(coursesMap.values()),
      events: Array.from(eventsMap.values()),
      syncedAt: new Date().toISOString(),
    };
  }

  async function triggerSync(force) {
    const stored = await chrome.storage.local.get([
      "appOrigin",
      "dashboardToken",
      "lastAutoSyncMs",
    ]);
    if (!stored.appOrigin || !stored.dashboardToken) return;

    const isAssignPage = /\/mod\/(assign|quiz)\/view\.php/i.test(
      location.pathname
    );
    const now = Date.now();
    if (
      !force &&
      !isAssignPage &&
      stored.lastAutoSyncMs &&
      now - stored.lastAutoSyncMs < MIN_AUTO_SYNC_INTERVAL_MS
    ) {
      return;
    }

    const payload = await collectMoodleData();
    if (!payload) return;

    await chrome.storage.local.set({ lastAutoSyncMs: now });
    return chrome.runtime.sendMessage({ type: "PUSH_MOODLE_SYNC", payload });
  }

  // Listen for manual sync requests from the extension popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "SYNC_NOW") {
      triggerSync(true)
        .then((res) => sendResponse(res || { ok: false, error: "Not logged in to Moodle" }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
  });

  // Auto-sync gently in the background whenever visiting Moodle or after submitting an assignment
  setTimeout(() => {
    triggerSync(false).catch(() => {});
  }, 1500);
})();
