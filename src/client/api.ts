import type {
  CompletionStatus,
  MoodleSyncPayload,
  WorkspaceDashboardResponse,
  WorkspaceSettings,
} from "../shared/types";

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof (data as { error?: string }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export function createWorkspace(body: {
  mode?: "demo" | "empty" | "url";
  moodleUrl?: string;
}): Promise<WorkspaceDashboardResponse> {
  return apiFetch("/api/workspaces", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchWorkspace(
  token: string,
  refresh = false
): Promise<WorkspaceDashboardResponse> {
  return apiFetch(
    `/api/w/${encodeURIComponent(token)}${refresh ? "?refresh=1" : ""}`
  );
}

export function refreshWorkspaceFeed(
  token: string
): Promise<WorkspaceDashboardResponse & { refreshResult?: { refreshed: boolean; error: string | null } }> {
  return apiFetch(`/api/w/${encodeURIComponent(token)}/refresh`, {
    method: "POST",
  });
}

export function updateMoodleUrl(
  token: string,
  moodleUrl: string
): Promise<WorkspaceDashboardResponse> {
  return apiFetch(`/api/w/${encodeURIComponent(token)}/moodle-url`, {
    method: "POST",
    body: JSON.stringify({ moodleUrl }),
  });
}

export function pushMoodleSync(
  token: string,
  payload: MoodleSyncPayload
): Promise<WorkspaceDashboardResponse> {
  return apiFetch(`/api/w/${encodeURIComponent(token)}/moodle-sync`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function patchItem(
  token: string,
  uid: string,
  patch: {
    manualStatus?: CompletionStatus | null;
    isProblemSetManual?: boolean | null;
    note?: string | null;
  }
): Promise<WorkspaceDashboardResponse> {
  return apiFetch(
    `/api/w/${encodeURIComponent(token)}/items/${encodeURIComponent(uid)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    }
  );
}

export function addManualProblemSet(
  token: string,
  input: {
    summary: string;
    courseKey?: string | null;
    dueIso: string;
    description?: string;
    moodleUrl?: string | null;
    status?: CompletionStatus;
  }
): Promise<WorkspaceDashboardResponse> {
  return apiFetch(`/api/w/${encodeURIComponent(token)}/items/manual`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function patchCourse(
  token: string,
  courseKey: string,
  patch: {
    customName?: string | null;
    visible?: boolean;
    color?: string | null;
  }
): Promise<WorkspaceDashboardResponse> {
  return apiFetch(
    `/api/w/${encodeURIComponent(token)}/courses/${encodeURIComponent(courseKey)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    }
  );
}

export function patchSettings(
  token: string,
  patch: Partial<WorkspaceSettings>
): Promise<WorkspaceDashboardResponse> {
  return apiFetch(`/api/w/${encodeURIComponent(token)}/settings`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function rotateFeedToken(
  token: string
): Promise<WorkspaceDashboardResponse> {
  return apiFetch(`/api/w/${encodeURIComponent(token)}/rotate-feed-token`, {
    method: "POST",
  });
}

export function deleteWorkspace(token: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/api/w/${encodeURIComponent(token)}`, {
    method: "DELETE",
  });
}
