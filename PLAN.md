# TAU Moodle → Apple / Google Calendar — Plan

Goal: a TAU student gets all Moodle deadlines/events into Apple or Google Calendar with the fewest possible setup steps, and it keeps updating with no machine of theirs running.

Status: research done (2026-11-17), nothing built yet.

## 1. Research findings

### TAU Moodle (probed from outside campus, 2026-11-17)
| Finding | Status |
|---|---|
| Login is SAML SSO via `nidp.tau.ac.il` (`/login/index.php` → `/2026/auth/saml2/login.php`). No way for a third-party app to offer "Log in with TAU". | CONFIRMED |
| Calendar export is enabled: `/2026/calendar/export_execute.php` with a fake token returns "Invalid authentication", not "export disabled". | CONFIRMED |
| Moodle is reachable from the public internet, so cloud runners and Google/Apple servers can fetch the feed. | CONFIRMED (from this machine; Google/Apple IPs untested) |
| Separate Moodle instance per academic year (`/2025`, `/2026`). The export link is per instance, so it likely needs regenerating each year. | CONFIRMED (instances exist); yearly re-setup INFERRED |
| Mobile web services (Moodle app API) appear **disabled** on the current instance (`enablemobilewebservice = 0` in public config; `1` on `/2025`). The API-token route is likely dead. | SUSPECTED. Verify via Moodle profile → Preferences → Security keys. |
| Whether the iCal export contains every deadline shown on the Moodle timeline. | UNVERIFIED. Needs a real export link. |

### Moodle generally (verified in Moodle source, `public/admin/settings/appearance.php`, `public/calendar/export_execute.php`)
- Export URL: `…/calendar/export_execute.php?userid=…&authtoken=…&preset_what=all&preset_time=…`.
- `enablecalendarexport` is on by default; admins can disable it.
- `preset_time=custom` spans `calendar_exportlookback` (default 5 days) to `calendar_exportlookahead` (default 365 days).
- The token is in the URL, so anyone with the link can read the calendar. It cannot be filtered per course.

### Calendar side
- **Google "From URL" subscriptions** refresh on Google's schedule, often 12–24 h. The interval isn't configurable and there's no manual refresh (third-party sources only; Google doesn't publish it).
- **Google Calendar API**: instant writes. A public OAuth app with calendar scope needs Google verification. Without it, the app is limited to ~100 test users and its tokens expire after 7 days while in "testing" status (from memory and one project's README; re-check before relying on it).
- **Apple**: no OAuth calendar API. Options are a `webcal://` subscription (one tap, refresh interval user-configurable, refreshed server-side when stored in iCloud) or CalDAV with an app-specific password (bad UX).
- Apple users can also add their Google account in Apple Calendar, so a Google calendar written by us shows up there too.

### Existing open-source projects (all small, 0–3 stars, single author; none to fork wholesale)
| Repo | What to take from it |
|---|---|
| [Ifaz-Ikram/moodle-calendar-sync](https://github.com/Ifaz-Ikram/moodle-calendar-sync) | Most complete Google sync (Apps Script, tests, dedup/update/delete). Uses username/password token, so it won't work with TAU SSO. |
| [Seeridia/maynooth-moodle-ics](https://github.com/Seeridia/maynooth-moodle-ics) | Clean `.ics` feed service (TS, Docker, tests). Shows how to build a feed with `ical-generator`. |
| [unignoramus11/sync-moodle-calendar](https://github.com/unignoramus11/sync-moodle-calendar) | Best sync pattern: store Moodle `UID` in Google event `extendedProperties.private`, then diff → create/update/delete. |
| [LSE-85100-2627/Moodle-calendar-sync](https://github.com/LSE-85100-2627/Moodle-calendar-sync) | Minimal Python + GitHub Actions cron example (no delete handling). |

## 2. Design decisions
- **Data source: the Moodle iCal export link**, not the Moodle API. It sidesteps SSO, needs no stored password, and is enabled at TAU. The API is a fallback only if the export turns out to miss events (and is probably disabled anyway).
- **Never collect TAU passwords** and never automate the SSO login. It's fragile, likely against TAU IT policy, and a big liability.
- **Get the link with a bookmarklet.** While logged into Moodle, the user clicks a bookmark. It submits Moodle's own export form (`/calendar/export.php`) in the user's session and hands the resulting URL to our page. This is the closest thing to "log in with Moodle". A browser extension is the polished version of the same thing (later).
- **Write into a dedicated "TAU Moodle" calendar**, never the user's main calendar. Removing it is then just deleting that calendar.

## 3. Phases

### Phase 0 — validate (no code)
1. Generate a real export link (Moodle → Calendar → Export → All events, custom range → Get URL).
2. Compare the `.ics` against the Moodle timeline: are assignments, quizzes, Zoom/lecture events, and course-level events all present?
3. Subscribe to the link in Google and Apple directly; note refresh lag and how titles look.
4. Check the Security keys page to confirm whether a Moodle mobile token exists.

If raw subscription is good enough, the MVP is just steps 1–3 written up as instructions.

### Phase 1 — MVP, no server (static page + bookmarklet)
- **Bookmarklet**: on `moodle.tau.ac.il/<year>/`, fetch `calendar/export.php`, submit with `preset_what=all`, `preset_time=custom`, read the generated URL, open our page with it as a URL fragment (`#feed=…`). Fragments aren't sent to any server.
- **Static page** (GitHub Pages / Cloudflare Pages):
  - **Add to Apple Calendar** → `webcal://…` link.
  - **Add to Google Calendar** → `https://calendar.google.com/calendar/r?cid=webcal://…`.
  - Instructions in Hebrew + English.
- Limitations accepted: Google refresh lag, raw Moodle titles, yearly re-setup.

### Phase 2 — cleaned feed (small serverless proxy)
- A Cloudflare Worker at `/feed/<id>.ics` fetches the Moodle feed, then:
  - prefixes titles with course short name, e.g. `[Calculus 1] HW 3 due`,
  - lets the user filter courses,
  - adds default reminders (`VALARM`),
  - normalises timezones (`Asia/Jerusalem`).
- Storing the Moodle URL server-side is a trust trade-off. Prefer encrypting it into the feed URL itself (stateless, no database).

### Phase 3 — fast Google sync (optional)
Two routes. Pick based on audience size.
- **A. Per-user Google Apps Script** (no server, no Google verification). The user copies a template script, pastes their export link, and runs `setup()`. That creates the calendar plus an hourly trigger that diffs by `UID` and creates/updates/deletes events, and emails on failure.
- **B. Hosted "Sign in with Google"** + Worker cron writing via Calendar API. Best UX, but needs Google OAuth verification beyond 100 users, plus a privacy policy, and stores refresh tokens.

Start with A. Move to B only if many classmates want it.

### Later / maybe
- Browser extension version of the bookmarklet (Chrome Web Store $5 one-time; Safari needs an Apple developer account).
- Auto-detect a new academic-year instance and prompt re-setup.
- Moodle API fallback if mobile web services get enabled.

## 4. Sync logic (Phase 3, shared by both routes)
```
events = parse_ics(fetch(moodle_export_url))
existing = calendar.list(privateExtendedProperty="moodleUid")
for e in events:      create if UID missing, update if changed fields
for x in existing:    delete if UID no longer in feed and x is in the future
on fetch/auth error:  notify user (token reset / new academic year)
```

## 5. Risks & open questions
- Does the TAU export include all deadlines? (Phase 0, step 2)
- Does the export token survive a password change? Moodle derives `authtoken` from user data plus a salt, so it may reset (INFERRED).
- Does Google's fetcher get blocked by TAU's firewall? (Phase 0, step 3)
- Is the bookmarklet blocked by Moodle's Content-Security-Policy? (Test early in Phase 1.)
- Yearly instance switch: what happens to the old link (dies, or returns empty)?

## 6. Sources
- Moodle Calendar export docs: https://docs.moodle.org/en/Calendar_export
- Moodle calendar settings: https://docs.moodle.org/en/Calendar_settings
- Moodle source (GitHub `moodle/moodle`, `main`): `public/admin/settings/appearance.php`, `public/calendar/export_execute.php`
- Moodle mobile SSO / token docs: https://docs.moodle.org/en/Moodle_Mobile_additional_features, https://tracker-old.moodle.org/browse/MDL-29583
- Google subscription refresh (third-party): https://usecarly.com/blog/google-calendar-ics-refresh-rate/
- TAU probes: `tool_mobile_get_public_config` via `lib/ajax/service-nologin.php` on `/`, `/2025`, `/2026`; `calendar/export_execute.php` with a dummy token.
