# Clock and Weather screen study

Owner request, 2026-11-03. Design study only; production implementation is pending.

## Accepted direction

- Celestial is always the first visible Today card, above the continuation hero, while retaining personal visibility and the Workspace `MOON` gate. Do not force-enable it or rewrite saved preferences. Preserve the relative order of other cards. Apply to Guide and classic presentation.
- Clock and Weather open dedicated screens from their existing header controls, replacing detail overlays. Preserve return context, browser Back, existing Weather settings/forecast addresses and opt-in gates.
- Both instruments borrow Celestial's contained navy surface, gold geometry, restrained serif headings and readable textual readings. The surrounding application follows the selected theme. Same information and actions on phones and desktops.
- Reuse the shared `MobileActionBar` infrastructure and its 48px icon-button geometry, accessible labels, safe areas and keyboard clearance from Procedure and other focused screens. Avoid a parallel action-bar implementation in production. The mockup simulates its appearance in normal document flow; production uses the existing component. Screens without a meaningful primary action should not invent one; allow a Back-only bar if necessary.

## Clock proposal

Clock, Stopwatch and Timer modes. Clock displays analogue and digital time, weekday/date, device IANA zone, local abbreviation and UTC offset. Keep device time separate from shared Workspace/weather location time; no inferred timezone changes. No per-second screen-reader announcements. The mockup freezes Clock at a labelled sample instant.

Stopwatch: elapsed minutes/seconds, Start, Pause/Resume, Lap and Reset. Laps stay local and ephemeral in this study. Timer: 5/15/25/60-minute presets, bounded custom minutes, remaining time/ring, Start, Pause/Resume and Reset. The two modes share the same positions for Back, Reset and the primary Start/Pause action; Lap is secondary. Mockup requires Reset before switching an active/paused mode to avoid silent loss.

Timing tools are a proposal prompted by the owner's suggestion, not production functionality. Before implementation decide whether both can run independently, navigation/reload persistence, completion sound and any notification behavior. Do not promise background/closed-app alerts. This local prototype uses elapsed timestamps, keeps running when moving between preview pages, and makes no notification, history or persistence claim. No points for navigation, laps or timer completion.

## Weather proposal

Prioritize effective location and its source (personal or opted-in Workspace), location time zone, current temperature and written condition, today's high/low, rain chance and rain amount, available wind speed, and tomorrow's compact outlook. Show provider/model and fetched time, plus conspicuous cached/offline and fallback indicators when applicable. All sample readings are fictional, not live forecasts.

Use existing normalized `WeatherCurrent`/`WeatherDay` fields. Missing current temperature is unavailable, never substituted from a daily maximum. Missing optional values must remain unavailable rather than imply zero. Distinguish current wind from daily maximum; distinguish provider issue time from fetch time; partial-day totals need a label. Honor existing `showTomorrow` and unit choices. Only claim a current condition when current data exists; otherwise label the daily outlook. More days and provider comparison can use existing forecast capabilities/settings rather than adding an unrelated data source.

Hourly charts, feels-like temperature, humidity, UV, air quality, radar and warnings are omitted: the current normalized data contract does not supply them. No new provider, geolocation, browser-to-provider request or paid query is proposed. Keep existing server switch/allowlist, credential isolation, personal opt-in, Workspace fallback and scoped offline-cache behavior. Celestial continues using only its gated shared location.

## Review and checks

Interactive in-chat mockup includes Clock/Stopwatch/Timer, Weather and a Today ordering preview; optional design controls switch digital-only presentation and cached Weather. No network or VMN API calls. Preview selection and timer-duration choice may be remembered by the conversation host; active timing and laps are not persisted. Browser checks at 320, 390, 736 and 1024px: no horizontal overflow; page switching, stopwatch start/lap/pause/reset, timer preset/start/pause passed with no page errors. Desktop Clock/Weather and timing screenshots were visually inspected. This does not certify physical phones, screen readers, alarm reliability or production navigation.

Security surface: unchanged; no production code, database, authentication, authorization, credentials, stored VMN preferences or forecast behavior changed. Existing owner asset directories were preserved. Remaining: owner visual review, production integration and its regression/contrast/accessibility/negative-gate checks. No release or deployment; owner milestone remains 45, next 46.

## Implementation accepted and completed — 2026-11-03

Owner approved implementation and release preparation after reviewing the mockup. The application now
has dedicated Clock/Weather routes and the existing shared action bar, with compact Today tiles in both
layouts and Celestial above the continuation hero. Profile keeps independent personal toggles; among
these three only Celestial defaults on, and its Workspace gate remains. Existing choices are preserved.

Resolved timing behavior: independent Stopwatch and Timer, state/laps in account-keyed tab memory across
navigation, explicit pause/resume/reset, 100-lap bound and 1–1440-minute custom duration. Reload/sign-out/
close resets timing; no sound or system/background alarm. The Weather response exposes effective place
and zone but does not identify whether fallback selected the personal or Workspace location, so production
does not guess a source-of-location badge. Forecast source/fallback/fetched/issue times remain explicit.

Production verification, actual browser captures and owner release 46 are recorded in ledger 27.2 and
its implementation/release continuation. Earlier proposal paragraphs above document the design history.
