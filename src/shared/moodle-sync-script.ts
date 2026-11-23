/**
 * Generates the self-contained TAU Moodle Sync Bookmarklet script.
 * Runs inside an already-authenticated moodle.tau.ac.il tab (zero passwords collected!):
 *  1. Extracts the user's Moodle iCal export URL (calendar/export.php -> export_execute.php)
 *  2. Queries Moodle's authenticated AJAX calendar endpoints for course full names + events
 *  3. Verifies exact submission status for assignments & quizzes (submitted / graded / draft / not_submitted)
 *  4. Pushes synced data to our Worker API (with URL-fragment fallback if cross-origin fetch is blocked)
 */
export function buildMoodleSyncSource(
  appOrigin: string,
  dashboardToken: string
): string {
  const safeOrigin = appOrigin.replace(/\/+$/, "");
  const endpoint = `${safeOrigin}/api/w/${encodeURIComponent(dashboardToken)}/moodle-sync`;
  const dashboardUrl = `${safeOrigin}/w/${encodeURIComponent(dashboardToken)}`;

  return `(async () => {
  const APP_ENDPOINT = ${JSON.stringify(endpoint)};
  const DASHBOARD_URL = ${JSON.stringify(dashboardUrl)};

  if (!location.hostname.includes("moodle.tau.ac.il")) {
    alert("Open TAU Moodle (moodle.tau.ac.il) and sign in first, then click this bookmarklet!");
    return;
  }

  const box = document.createElement("div");
  box.id = "tau-cal-sync-overlay";
  box.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;background:#0f294a;color:#fff;padding:14px 18px;border-radius:12px;font-family:system-ui,-apple-system,sans-serif;font-size:14px;box-shadow:0 12px 32px rgba(0,0,0,0.28);max-width:340px;line-height:1.45;direction:ltr;";
  const setStatus = (msg, ok) => {
    box.innerHTML = '<div style="font-weight:700;margin-bottom:4px;">TAU Moodle Calendar Sync</div><div>' + msg + '</div>' +
      (ok ? '<div style="margin-top:8px;"><a href="' + DASHBOARD_URL + '" target="_blank" style="color:#6ee7b7;font-weight:600;text-decoration:underline;">Open Dashboard &rarr;</a></div>' : '');
  };
  document.body.appendChild(box);
  setStatus("Connecting to TAU Moodle session...");

  try {
    const baseUrl = (window.M && window.M.cfg && window.M.cfg.wwwroot)
      ? window.M.cfg.wwwroot.replace(/\\/+$/, "")
      : (location.origin + (location.pathname.match(/^\\/\\d{4}/)?.[0] || ""));

    let sesskey = (window.M && window.M.cfg && window.M.cfg.sesskey) || "";
    if (!sesskey) {
      const inp = document.querySelector('input[name="sesskey"]');
      if (inp) sesskey = inp.value;
    }

    // Step 1: Extract Moodle iCal export URL via Moodle's own export form
    setStatus("1/3 Reading Moodle calendar export link...");
    let exportUrl = "";
    try {
      const exportPageRes = await fetch(baseUrl + "/calendar/export.php", { credentials: "include" });
      const exportHtml = await exportPageRes.text();
      const doc = new DOMParser().parseFromString(exportHtml, "text/html");
      const form = doc.querySelector('form[action*="export.php"]') || doc.querySelector("form.mform");
      if (form) {
        const fd = new URLSearchParams();
        form.querySelectorAll('input[type="hidden"]').forEach((el) => {
          if (el.name) fd.set(el.name, el.value);
        });
        if (!sesskey && fd.get("sesskey")) sesskey = fd.get("sesskey");
        fd.set("events[exportevents]", "all");
        const hasCustom = !!form.querySelector('input[name="period[timeperiod]"][value="custom"]');
        fd.set("period[timeperiod]", hasCustom ? "custom" : "recentupcoming");
        fd.set("generateurl", "Get calendar URL");

        const postRes = await fetch(baseUrl + "/calendar/export.php", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: fd.toString(),
        });
        const postHtml = await postRes.text();
        const urlMatch = postHtml.match(/https?:\\/\\/[^"'<>\\s]+calendar\\/export_execute\\.php\\?[^"'<>\\s]+/i);
        if (urlMatch) {
          exportUrl = urlMatch[0].replace(/&amp;/g, "&");
        }
      }
    } catch (e) {
      console.warn("Export URL extraction warning:", e);
    }

    // Step 2: Query Moodle authenticated AJAX calendar APIs
    setStatus("2/3 Fetching courses & calendar deadlines...");
    const now = new Date();
    const ajaxCalls = [];
    for (let offset = -1; offset <= 4; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      ajaxCalls.push({
        index: ajaxCalls.length,
        methodname: "core_calendar_get_calendar_monthly_view",
        args: { year: d.getFullYear(), month: d.getMonth() + 1, courseid: 1, mini: false },
      });
    }
    const timesortFrom = Math.floor(Date.now() / 1000) - 60 * 86400;
    ajaxCalls.push({
      index: ajaxCalls.length,
      methodname: "core_calendar_get_action_events_by_timesort",
      args: { timesortfrom: timesortFrom, limitnum: 50 },
    });

    const coursesMap = new Map();
    const eventsMap = new Map();
    const pendingActionIds = new Set();
    const hostAddress = baseUrl.replace(/^https?:\\/\\//, "");

    if (sesskey) {
      const ajaxRes = await fetch(baseUrl + "/lib/ajax/service.php?sesskey=" + encodeURIComponent(sesskey), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ajaxCalls),
      });
      const ajaxData = await ajaxRes.json();
      if (Array.isArray(ajaxData)) {
        const last = ajaxData[ajaxData.length - 1];
        if (last && !last.error && last.data && Array.isArray(last.data.events)) {
          for (const ev of last.data.events) {
            pendingActionIds.add(ev.id);
          }
        }
        for (let i = 0; i < ajaxData.length - 1; i++) {
          const item = ajaxData[i];
          if (!item || item.error || !item.data || !Array.isArray(item.data.weeks)) continue;
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
                  initialStatus = (ev.isactionevent || pendingActionIds.has(ev.id))
                    ? "not_submitted"
                    : "submitted";
                } else if (mod === "quiz" && (evType === "close" || evType === "due")) {
                  if (ev.isactionevent || pendingActionIds.has(ev.id)) {
                    initialStatus = "not_submitted";
                  }
                }
                eventsMap.set(ev.id, {
                  eventId: ev.id,
                  uid: ev.id + "@" + hostAddress,
                  name: ev.name || "",
                  description: (ev.description || "").replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim(),
                  modulename: mod,
                  eventtype: evType,
                  timestart: ev.timestart,
                  timeduration: ev.timeduration || 0,
                  courseShortname: ev.course?.shortname || undefined,
                  courseFullname: ev.course?.fullname || undefined,
                  courseId: ev.course?.id || undefined,
                  url: ev.url || (ev.action && ev.action.url) || null,
                  moodleStatus: initialStatus,
                  moodleStatusDetail: null,
                });
              }
            }
          }
        }
      }
    }

    // Step 3: Deep-verify exact submission status on assignment & quiz pages (language-independent CSS classes!)
    const verifiable = Array.from(eventsMap.values())
      .filter((e) => e.url && (e.modulename === "assign" || e.modulename === "quiz"))
      .slice(0, 30);

    if (verifiable.length > 0) {
      setStatus("3/3 Verifying submission status for " + verifiable.length + " problem sets...");
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
                ev.moodleStatusDetail = doc.querySelector(".submissiongraded")?.textContent?.trim() || null;
              } else if (doc.querySelector(".submissionstatussubmitted")) {
                ev.moodleStatus = "submitted";
                ev.moodleStatusDetail = doc.querySelector(".submissionstatussubmitted")?.textContent?.trim() || null;
              } else if (doc.querySelector(".submissionstatusdraft")) {
                ev.moodleStatus = "draft";
                ev.moodleStatusDetail = doc.querySelector(".submissionstatusdraft")?.textContent?.trim() || null;
              } else if (doc.querySelector(".submissionstatusnew, .submissionstatusreopened")) {
                ev.moodleStatus = "not_submitted";
              } else {
                const txt = doc.querySelector(".submissionstatustable")?.textContent || "";
                if (/submitted for grading|הוגש למתן ציון/i.test(txt)) ev.moodleStatus = "submitted";
                else if (/draft|טיוטה/i.test(txt)) ev.moodleStatus = "draft";
                else if (/no attempt|no submission|לא בוצעה הגשה|לא הוגש/i.test(txt)) ev.moodleStatus = "not_submitted";
              }
            } else if (ev.modulename === "quiz") {
              const summary = doc.querySelector(".quizattemptsummary");
              if (summary) {
                const txt = summary.textContent || "";
                if (/finished|הושלם|נשלח|הוגש/i.test(txt)) ev.moodleStatus = "submitted";
                else if (/in progress|בתהליך/i.test(txt)) ev.moodleStatus = "draft";
              }
            }
          } catch (_) {}
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    }

    const payload = {
      exportUrl: exportUrl || undefined,
      moodleBaseUrl: baseUrl,
      courses: Array.from(coursesMap.values()),
      events: Array.from(eventsMap.values()),
      syncedAt: new Date().toISOString(),
    };

    try {
      const syncRes = await fetch(APP_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!syncRes.ok) throw new Error("HTTP " + syncRes.status);
      const data = await syncRes.json();
      const s = data.stats || {};
      setStatus(
        "Synced " + (s.totalProblemSets ?? payload.events.length) + " problem sets (" +
        (s.completedCount ?? 0) + " completed, " + (s.notCompletedCount ?? 0) + " pending)!",
        true
      );
    } catch (fetchErr) {
      // Fallback: hand off compact payload via URL fragment (never blocked by mixed content / CSP)
      const jsonStr = JSON.stringify(payload);
      const bytes = new TextEncoder().encode(jsonStr);
      let bin = "";
      bytes.forEach((b) => (bin += String.fromCharCode(b)));
      const b64 = btoa(bin).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
      setStatus("Opening dashboard to complete sync...", true);
      window.open(DASHBOARD_URL + "#sync=" + b64, "_blank");
    }
  } catch (err) {
    setStatus("Sync error: " + (err && err.message ? err.message : String(err)), false);
  }
})();`;
}

/**
 * Minifies the bookmarklet source into a draggable `javascript:...` href.
 * Only strips standalone comment lines (never touches `https://` or regex `\/` literals!).
 */
export function buildBookmarkletHref(
  appOrigin: string,
  dashboardToken: string
): string {
  const src = buildMoodleSyncSource(appOrigin, dashboardToken)
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return "javascript:" + encodeURIComponent(src);
}
