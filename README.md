# কেমনে যাবো · Kemne Jabo

A free, ad-free Dhaka local-bus guide (see `Dhaka-Bus-Guide-PRD-v2.md`). Say or type where you are and where you're going; get the bus, the stop, the official fare and an honest idea of the wait. Bangla first, English alongside.

Static site. **No build step, no dependencies, no accounts.**

## Run it

```bash
python -m http.server 5173 --bind 127.0.0.1
```

Open <http://localhost:5173>. It must be served over `http://localhost` or `https` — browsers only allow the microphone on secure origins, and ES modules don't load from `file://`.

Voice works in Chrome (Android and desktop) and Edge; it needs internet because the browser sends the audio to its own speech service. Everywhere else the typed fallback is always on screen.

## What's in the box (PRD §6)

| PRD | Where |
| --- | --- |
| Trip search with Bangla/English suggestions | `js/search.js`, `js/text.js` (phonetic matching: মিরপুর = Mirpur = mirpoor) |
| Nearest-stop guide: walk vs rickshaw, area hints, fixed map | `legBetween`, `data/areas.json`, `js/map.js` (whole-trip map) |
| Every bus for the trip, grouped by where to board (stops within 350 m count as the same place); one change only when nothing is direct | `planTrip` |
| Official fare from one editable setting | `data/settings.json` (gazette 23 Sep 2026: bus 2.70, minibus 2.60 per km; min 10 / 8) |
| Bus seen (30 min expiry, rate limits, wrong-report button) | `js/store.js`, `paintSeen` in `js/app.js` |
| Rider fare feedback (timed prompt, one-tap amounts, 25–75th percentile, ≥5 reports) | `openFare`, `riderFareRange` |
| Report a problem, Verified / Not yet verified label | `openReport`, `trustLine` |
| Use my location — optional, memory only, never in the URL or storage | `locate` |
| Voice input | below |

## Voice, end to end

`js/voice.js` → `js/parse.js` → `js/search.js` → confirm card in `js/app.js`.

1. **Listen** — one big mic. Your words appear live as the page heading. Tap again to finish, `Esc` to cancel. The voice language follows the page language: Bangla (`bn-BD`, falls back to `bn-IN`) or English (`en-IN`).
2. **Understand** — `parseTrip` handles `X থেকে Y`, `Y যাবো X থেকে`, `X-এ আছি, Y যাব`, `from X to Y`, `X theke Y jabo`, `এখান থেকে Y` (= my location), Bangla digits and number words (`মিরপুর দশ`, `মিরপুর টেন`), case endings (`মতিঝিলে`).
3. **Match** — every recogniser alternative is tried; each phrase is matched on a consonant skeleton so spelling and vowel noise don't matter. Numbers must match exactly (`Mirpur 1` ≠ `Mirpur 10`).
4. **Confirm** — a card shows what was heard and the two places. Ambiguous names ("মিরপুর") ask "which one?" with tappable choices, and you can answer by voice ("দশ নম্বর"). Nothing is searched until you confirm.
5. **Fail well** — silence, blocked mic, offline, unsupported browser/language and insecure origin each have their own message and a one-tap way back to typing.
6. **Listen back** — "শুনুন" reads the best option aloud when the device has a voice for the language (the button hides itself otherwise).

Verification done:
- `npm test` — 3,898 parser/matching/routing/data checks and 37 voice-session/store checks (scripted recogniser: results, interim-only end, every error code, language fallback, stop, cancel, silence timeout, double `onend`).
- In a real browser pane with a scripted `SpeechRecognition` (`tests/fake-sr.js`): tap mic → live words → confirm card → results; ambiguity + answering by voice; field mics; stop; Esc; English; error notices.
- **Not done:** a real microphone with real Bangla speech. The development browser blocks the mic, so that last mile needs a human with Chrome on a phone. Do this before launch and note which phrases fail.

## Data — read this

`data/*.json` is **generated**; don't edit it by hand.

1. `python -I tools/import-dbs.py <saved dhakabusservice.com home page>` → `tools/dbs-raw.json` (183 buses: real names, ordered stops, hours, seating type).
2. `node tools/build-data.mjs` → `data/stops.json`, `routes.json`, `areas.json`, `settings.json` (252 stops).

How stop positions are found: 70 from hand-placed anchors in `tools/seed.mjs` (exact names only), 148 from OpenStreetMap — when OSM returns several places with that name, the one next to the stop's route neighbours wins — and 34 marked `"coord": "approx"`, placed between their neighbours. 7 obvious source typos (a stop 10+ km off the route) are dropped. The script prints every hop over 7 km so a person can review it; most are real highway hops (Savar, Gazipur).

Honest limits: every route is still "not yet verified"; `dhakabusservice.com` has no frequency data, so the app shows operating hours instead of "every N minutes"; ride times and fares are computed from distance (official rate, Tk 2.70/km, minimum Tk 10). **You chose to use dhakabusservice.com's data directly — ask them for permission before going public**, and credit them (the app already does).

## Going live with shared reports

By default "bus seen" and fare reports are stored **on the rider's own device**, and the app says so. To share them between riders:

1. Create a free Supabase project. Run `supabase/schema.sql`, then `node tools/export-sql.mjs` and run the generated `supabase/seed.sql`.
2. Put the project URL and anon key in `js/config.js`.
3. Optional: schedule the expiry job at the bottom of `schema.sql`.

The browser can only call six functions; the tables are closed by row-level security. The functions check that the bus serves the stop, rate-limit per device, and store no position. (Written against the PRD but **not yet run against a live Supabase project**.)

## Map

One map per option, showing the whole trip: you → boarding stop → the bus's real stop-to-stop path → get-off stop → destination (walking legs dotted, the bus path drawn in the bus's colour with a small bus riding it). On a bus's page the whole route is shown with the rider's stretch highlighted. It is a still picture — OSM tiles placed by `js/map.js`, no panning — and it only draws once its box has a real size, so tiles and overlay always line up. The default tile URL is the public OSM server (fine for a trial, against their policy at scale): point `tileUrl` in `js/config.js` at a self-hosted Dhaka tile source before launch. Walking lines are straight, not routed.

## Look and motion (v3)

Warm paper background, ink-outlined "sticker" cards, Baloo Da 2 for display type and Hind Siliguri for text, dark mode as a night scene. All artwork is inline SVG generated in `js/art.js`, styled and animated in `css/art.css`:

- six painted buses (`PAINTS`) after the ones that run in Dhaka — each bus route gets one paint job, picked from its id, so a bus looks the same everywhere
- the home screen is a street scene: parallax skyline with a mosque and flyover, a road, a bus you can tap to honk (a short two-note horn via WebAudio), another bus overtaking, a rickshaw drifting by
- while listening the town holds still and the bus flashes its headlights; the headline shows what's being heard
- pressing Find sends a small bus across the button; each result bus drives into its card; the rail between "get on" and "get off" draws itself with a bus token riding it
- everything stops under `prefers-reduced-motion`

Results are a step-by-step rail: *start → walk/rickshaw → get on at X → take any one of these buses → get off at Y → walk → arrive*. A dark card on top answers in one line (direct / one change / just walk) with the fare range, ride time and bus count. Stops under 400 m apart are never offered as a bus ride, and places under 650 m apart get "it's close, walk".

## Files

```
index.html  css/styles.css · css/art.css
js/  app.js (UI, voice flow, router) · art.js (buses, scene, logo) · voice.js · parse.js · search.js · text.js · store.js · map.js · i18n.js · icons.js · ui.js · config.js
data/  stops · routes · areas · settings (.json)
tools/ import-dbs.py · dbs-raw.json · seed.mjs · build-data.mjs · export-sql.mjs      supabase/ schema.sql · seed.sql
tests/ run.mjs · voice-store.mjs · fake-sr.js
```

## Still open (PRD §16)

Fare rounding in practice (currently nearest taka); walk/rickshaw threshold (500 m, `walk_threshold_m`); report visibility (30 min, `seen_ttl_min`); rickshaw price ranges (none shown until rider data exists); metro, saved places, late-night warnings (v2).
