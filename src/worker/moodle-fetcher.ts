import { buildDemoTauData } from "../shared/demo-data";

const MAX_ICS_BYTES = 4 * 1024 * 1024; // 4 MB safety cap per Workers best practices
const FETCH_TIMEOUT_MS = 15_000;

export interface ValidatedMoodleUrl {
  normalizedUrl: string;
  moodleBaseUrl: string;
  isDemo: boolean;
}

/**
 * Strictly validates a TAU Moodle calendar export URL to prevent SSRF and catch copy-paste errors early.
 */
export function validateMoodleExportUrl(rawInput: string): ValidatedMoodleUrl {
  const trimmed = rawInput.trim();
  if (trimmed === "demo://tau-2026") {
    return {
      normalizedUrl: "demo://tau-2026",
      moodleBaseUrl: "https://moodle.tau.ac.il/2026",
      isDemo: true,
    };
  }

  let parsed: URL;
  try {
    // Allow users who accidentally pasted webcal:// instead of https://
    const normalizedProtocol = trimmed.replace(/^webcal:\/\//i, "https://");
    parsed = new URL(normalizedProtocol);
  } catch {
    throw new Error(
      "Invalid URL format. Please paste the full URL from Moodle Calendar Export."
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Moodle calendar URL must use HTTPS.");
  }

  const host = parsed.hostname.toLowerCase();
  const isTauHost =
    host === "moodle.tau.ac.il" ||
    host.endsWith(".moodle.tau.ac.il") ||
    host === "tau.ac.il" ||
    host.endsWith(".tau.ac.il");

  if (!isTauHost) {
    throw new Error(
      "URL must point to Tel Aviv University Moodle (moodle.tau.ac.il)."
    );
  }

  if (!parsed.pathname.endsWith("/calendar/export_execute.php")) {
    throw new Error(
      "URL must be a Moodle calendar export link ending in /calendar/export_execute.php."
    );
  }

  const authtoken = parsed.searchParams.get("authtoken");
  const userid = parsed.searchParams.get("userid");
  const username = parsed.searchParams.get("username");

  if (!authtoken || (!userid && !username)) {
    throw new Error(
      "Moodle export URL is missing userid or authtoken parameters."
    );
  }

  // Upgrade preset_time to custom only if missing
  if (!parsed.searchParams.get("preset_what")) {
    parsed.searchParams.set("preset_what", "all");
  }
  if (!parsed.searchParams.get("preset_time")) {
    parsed.searchParams.set("preset_time", "custom");
  }

  const basePath = parsed.pathname.replace(/\/calendar\/export_execute\.php$/, "");
  const moodleBaseUrl = `${parsed.origin}${basePath}`;

  return {
    normalizedUrl: parsed.toString(),
    moodleBaseUrl,
    isDemo: false,
  };
}

/**
 * Reads a response stream up to maxBytes to prevent memory exhaustion in Workers.
 */
async function readBoundedText(
  response: Response,
  maxBytes: number
): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let totalBytes = 0;
  let result = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("Response exceeded maximum allowed size");
        throw new Error("Moodle calendar feed exceeded maximum supported size (4 MB).");
      }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  return result;
}

export interface FetchMoodleIcsResult {
  icsText: string;
  fetchedAt: string;
}

/**
 * Fetches and validates the live iCalendar feed from TAU Moodle (or generates Demo ICS).
 */
export async function fetchMoodleIcs(
  exportUrl: string
): Promise<FetchMoodleIcsResult> {
  const now = new Date();

  if (exportUrl === "demo://tau-2026") {
    return {
      icsText: buildDemoTauData(now).rawIcs,
      fetchedAt: now.toISOString(),
    };
  }

  const response = await fetch(exportUrl, {
    method: "GET",
    headers: {
      Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
      "User-Agent": "TAU-Moodle-Calendar-Sync/1.0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `TAU Moodle returned HTTP ${response.status}. Check if the academic year changed or your export link needs refreshing.`
    );
  }

  const text = await readBoundedText(response, MAX_ICS_BYTES);
  const trimmed = text.trim();

  if (/invalid authentication/i.test(trimmed)) {
    throw new Error(
      "TAU Moodle rejected the export token (Invalid authentication). Click the Sync Bookmarklet on Moodle to regenerate it."
    );
  }
  if (/^no export$/i.test(trimmed)) {
    throw new Error("Calendar export appears to be disabled on this Moodle instance.");
  }
  if (/<!doctype html|<html/i.test(trimmed.slice(0, 400))) {
    throw new Error(
      "TAU Moodle returned a login page instead of an iCalendar feed. Your link may belong to an archived year or expired token."
    );
  }
  if (!trimmed.includes("BEGIN:VCALENDAR")) {
    throw new Error(
      "TAU Moodle did not return a valid iCalendar (.ics) document."
    );
  }

  return {
    icsText: text,
    fetchedAt: now.toISOString(),
  };
}
