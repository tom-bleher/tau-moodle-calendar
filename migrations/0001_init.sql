-- TAU Moodle Calendar Sync & Problem Set Tracker Schema

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  dashboard_token TEXT NOT NULL UNIQUE,
  feed_token TEXT NOT NULL UNIQUE,
  moodle_url_encrypted TEXT,
  moodle_base_url TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT NOT NULL,
  cached_ics TEXT,
  cached_ics_at TEXT,
  last_moodle_sync_at TEXT,
  last_feed_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspaces_dashboard_token ON workspaces(dashboard_token);
CREATE INDEX IF NOT EXISTS idx_workspaces_feed_token ON workspaces(feed_token);

CREATE TABLE IF NOT EXISTS courses (
  workspace_id TEXT NOT NULL,
  course_key TEXT NOT NULL,
  moodle_course_id INTEGER,
  shortname TEXT NOT NULL,
  fullname TEXT,
  custom_name TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  color TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, course_key),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS calendar_items (
  workspace_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  moodle_event_id INTEGER,
  course_key TEXT,
  summary TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT,
  dtstart TEXT NOT NULL,
  dtend TEXT NOT NULL,
  is_all_day INTEGER NOT NULL DEFAULT 0,
  last_modified TEXT,
  modulename TEXT,
  eventtype TEXT,
  moodle_url TEXT,
  is_problem_set_auto INTEGER NOT NULL DEFAULT 0,
  is_problem_set_manual INTEGER,
  moodle_status TEXT NOT NULL DEFAULT 'unknown',
  moodle_status_detail TEXT,
  moodle_status_updated_at TEXT,
  manual_status TEXT,
  manual_status_updated_at TEXT,
  note TEXT,
  in_live_feed INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, uid),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_items_workspace_dtstart ON calendar_items(workspace_id, dtstart);
