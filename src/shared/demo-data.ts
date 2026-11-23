import type { MoodleSyncPayload } from "./types";

function toIcsUtc(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}T` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}

function daysFromNow(now: Date, days: number, hourUtc = 21, minute = 59): Date {
  const d = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  d.setUTCHours(hourUtc, minute, 0, 0);
  return d;
}

/**
 * Generates a realistic TAU semester iCal (.ics) feed + Moodle completion snapshot
 * anchored to the current date so users can test every feature immediately.
 */
export function buildDemoTauData(now: Date = new Date()): {
  rawIcs: string;
  moodleSync: MoodleSyncPayload;
} {
  const courses = [
    {
      id: 4101,
      shortname: "0368-2158-01",
      fullname: "מבוא לאלגוריתמים",
    },
    {
      id: 4102,
      shortname: "0368-2160-01",
      fullname: "מבני נתונים",
    },
    {
      id: 4103,
      shortname: "0366-1102-01",
      fullname: "אלגברה לינארית 1ב",
    },
    {
      id: 4104,
      shortname: "0368-3065-01",
      fullname: "Machine Learning",
    },
  ];

  interface DemoSpec {
    id: number;
    courseIdx: number;
    summary: string;
    description: string;
    dayOffset: number;
    hourUtc: number;
    minute: number;
    durationMinutes: number;
    modulename: string | null;
    eventtype: string;
    urlPath: string | null;
    moodleStatus: "submitted" | "graded" | "draft" | "not_submitted" | "unknown";
    moodleStatusDetail?: string;
    location?: string;
  }

  const specs: DemoSpec[] = [
    {
      id: 80101,
      courseIdx: 0,
      summary: "תרגיל בית 1 - רדוקציות וגרפים - יש להגיש",
      description:
        "הגשת תרגיל בית 1 בקובץ PDF בלבד. כולל ניתוח סיבוכיות מלא.",
      dayOffset: -10,
      hourUtc: 21,
      minute: 59,
      durationMinutes: 0,
      modulename: "assign",
      eventtype: "due",
      urlPath: "/mod/assign/view.php?id=9101",
      moodleStatus: "graded",
      moodleStatusDetail: "98 / 100",
    },
    {
      id: 80102,
      courseIdx: 1,
      summary: "תרגיל בית 2 - עצי AVL וטבלאות גיבוב - יש להגיש",
      description: "הגשת קוד ב-Python + דוח קצר על זמני ריצה.",
      dayOffset: -5,
      hourUtc: 21,
      minute: 59,
      durationMinutes: 0,
      modulename: "assign",
      eventtype: "due",
      urlPath: "/mod/assign/view.php?id=9102",
      moodleStatus: "submitted",
      moodleStatusDetail: "Submitted for grading",
    },
    {
      id: 80103,
      courseIdx: 2,
      summary: "תרגיל בית 3 - ערכים ווקטורים עצמיים - יש להגיש",
      description: "שאלות 1–5 מתוך חוברת התרגילים. יש לסרוק בבירור.",
      dayOffset: -2,
      hourUtc: 21,
      minute: 59,
      durationMinutes: 0,
      modulename: "assign",
      eventtype: "due",
      urlPath: "/mod/assign/view.php?id=9103",
      moodleStatus: "not_submitted",
    },
    {
      id: 80104,
      courseIdx: 3,
      summary: "Problem Set 2: Logistic Regression & SVMs is due",
      description:
        "Submit your Jupyter notebook and PDF report via Moodle before 23:59 Israel time.",
      dayOffset: 1,
      hourUtc: 21,
      minute: 59,
      durationMinutes: 0,
      modulename: "assign",
      eventtype: "due",
      urlPath: "/mod/assign/view.php?id=9104",
      moodleStatus: "draft",
      moodleStatusDetail: "Draft (not submitted)",
    },
    {
      id: 80105,
      courseIdx: 0,
      summary: "תרגיל בית 2 - תכנות דינמי וזרימה ברשתות - יש להגיש",
      description: "ניתן להגיש בזוגות. חובה לציין ת״ז של שני השותפים.",
      dayOffset: 3,
      hourUtc: 21,
      minute: 59,
      durationMinutes: 0,
      modulename: "assign",
      eventtype: "due",
      urlPath: "/mod/assign/view.php?id=9105",
      moodleStatus: "not_submitted",
    },
    {
      id: 80106,
      courseIdx: 1,
      summary: "בוחן מקוון 2 - עצי חיפוש מאוזנים",
      description: "בוחן אמצע מקוון במודל, 30 דקות, ניסיון אחד.",
      dayOffset: 4,
      hourUtc: 17,
      minute: 0,
      durationMinutes: 30,
      modulename: "quiz",
      eventtype: "close",
      urlPath: "/mod/quiz/view.php?id=9106",
      moodleStatus: "not_submitted",
    },
    {
      id: 80107,
      courseIdx: 3,
      summary: "Problem Set 1: Linear Regression & Bias-Variance is due",
      description: "Submitted early and verified.",
      dayOffset: 5,
      hourUtc: 21,
      minute: 59,
      durationMinutes: 0,
      modulename: "assign",
      eventtype: "due",
      urlPath: "/mod/assign/view.php?id=9107",
      moodleStatus: "submitted",
      moodleStatusDetail: "Submitted for grading",
    },
    {
      id: 80108,
      courseIdx: 2,
      summary: "תרגיל בית 4 - מכפלה פנימית וגרם-שמידט - יש להגיש",
      description: "הגשה דרך מודל בלבד. אין הארכות לאחר מועד הסגירה.",
      dayOffset: 8,
      hourUtc: 21,
      minute: 59,
      durationMinutes: 0,
      modulename: "assign",
      eventtype: "due",
      urlPath: "/mod/assign/view.php?id=9108",
      moodleStatus: "not_submitted",
    },
    {
      id: 80109,
      courseIdx: 0,
      summary: "הרצאה 6 - אלגוריתמי קירוב",
      description: "הרצאה פרונטלית באולם שרייבר 007.",
      dayOffset: 2,
      hourUtc: 10,
      minute: 0,
      durationMinutes: 120,
      modulename: null,
      eventtype: "course",
      urlPath: null,
      moodleStatus: "unknown",
      location: "Schreiber 007, Tel Aviv University",
    },
    {
      id: 80110,
      courseIdx: 1,
      summary: "תרגול 5 - עצי אדום-שחור (זום)",
      description: "שיעור תרגול שבועי מוקלט.",
      dayOffset: 3,
      hourUtc: 14,
      minute: 0,
      durationMinutes: 60,
      modulename: null,
      eventtype: "course",
      urlPath: null,
      moodleStatus: "unknown",
      location: "Zoom",
    },
  ];

  const baseUrl = "https://moodle.tau.ac.il/2026";
  const host = "moodle.tau.ac.il/2026";
  const dtstamp = toIcsUtc(now);

  const icsLines: string[] = [
    "BEGIN:VCALENDAR",
    "METHOD:PUBLISH",
    "PRODID:-//Moodle Pty Ltd//NONSGML Moodle Version 2026//EN",
    "VERSION:2.0",
  ];

  const moodleEvents: MoodleSyncPayload["events"] = [];

  for (const s of specs) {
    const course = courses[s.courseIdx];
    const start = daysFromNow(now, s.dayOffset, s.hourUtc, s.minute);
    const end = new Date(start.getTime() + s.durationMinutes * 60 * 1000);
    const uid = `${s.id}@${host}`;

    icsLines.push("BEGIN:VEVENT");
    icsLines.push(`UID:${uid}`);
    icsLines.push(`SUMMARY:${s.summary}`);
    icsLines.push(`DESCRIPTION:${s.description}`);
    icsLines.push("CLASS:PUBLIC");
    icsLines.push(`LAST-MODIFIED:${dtstamp}`);
    if (s.location) icsLines.push(`LOCATION:${s.location}`);
    icsLines.push(`DTSTAMP:${dtstamp}`);
    icsLines.push(`DTSTART:${toIcsUtc(start)}`);
    icsLines.push(`DTEND:${toIcsUtc(end)}`);
    icsLines.push(`CATEGORIES:${course.shortname}`);
    icsLines.push("END:VEVENT");

    moodleEvents.push({
      eventId: s.id,
      uid,
      name: s.summary,
      description: s.description,
      modulename: s.modulename,
      eventtype: s.eventtype,
      timestart: Math.floor(start.getTime() / 1000),
      timeduration: s.durationMinutes * 60,
      courseShortname: course.shortname,
      courseFullname: course.fullname,
      courseId: course.id,
      url: s.urlPath ? `${baseUrl}${s.urlPath}` : null,
      moodleStatus: s.moodleStatus,
      moodleStatusDetail: s.moodleStatusDetail ?? null,
    });
  }

  icsLines.push("END:VCALENDAR");

  return {
    rawIcs: icsLines.join("\r\n") + "\r\n",
    moodleSync: {
      exportUrl: "demo://tau-2026",
      moodleBaseUrl: baseUrl,
      courses,
      events: moodleEvents,
      syncedAt: now.toISOString(),
    },
  };
}
