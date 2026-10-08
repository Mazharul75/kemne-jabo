# Dhaka Bus Guide (ঢাকা বাস গাইড): Product Requirements Document

**Version:** 2.0 (draft)
**Date:** 9 October 2026
**Status:** Ready for MVP build

**What changed from v1:** added the "Bus seen" feature (the headline feature), a fixed map with no live data, and a "from any lane" guide that says whether to walk or take a rickshaw.

---

## 1. Summary

Dhaka Bus Guide is a free, ad-free website for people in Dhaka who don't know which local bus to take. A user says where they are and where they want to go. The site tells them how to reach the nearest stop, which buses to take, where to wait, how long the wait usually is, and what the fare should be.

Riders keep it alive. One tap says "I just saw this bus here", and one tap after a trip says "I paid this much". There is no paid live data, and no live bus tracking.

This is a public-benefit project. It is not built to make money. The goal is to make getting around Dhaka easier for ordinary Bangladeshis.

## 2. Problem

- Dhaka has hundreds of local bus routes, but no simple place to ask "how do I get from here to there?"
- A newcomer, or anyone going to an unfamiliar area, doesn't know which bus to take, where to stand, or what the fare should be.
- Many lanes and roads have no bus at all. People don't know whether to walk or take a rickshaw to reach a bus.
- Fares are often disputed. The government sets the rate, but conductors sometimes charge more.
- Route information is scattered across Facebook pages, blogs, and word of mouth, and much of it is out of date.
- Official records don't match reality. A Dhaka Transport Coordination Authority (DTCA) survey found only 98 of 418 approved routes were active, with hundreds more unauthorised or inactive.

## 3. Goals and non-goals

### Goals
1. Answer "which bus do I take from A to B?" in under 10 seconds.
2. Work from anywhere, including a lane with no bus, by guiding the user to the nearest stop.
3. Show the official fare and what riders actually paid.
4. Give a rider-powered sense of "is a bus coming?" without any paid live data.
5. Work on any phone through the browser, in Bangla and English, with voice input.
6. Stay minimal: one clear purpose on the first screen.
7. Cost almost nothing to run.

### Non-goals (for the first release)
- No ticket booking or payments.
- No GPS tracking of buses. No public live feed exists for Dhaka's local buses, and we can't pay for one.
- No ride-hailing, CNG, or rickshaw booking.
- No coverage outside Dhaka at launch.
- No ads, no monetisation, no user accounts.

## 4. Users

| User | Situation | What they need |
| --- | --- | --- |
| Newcomer or visitor | Doesn't know the area | Clear steps, which bus, where to stand |
| Regular commuter | Knows the main route, not the rest | Alternatives, fare check, "is a bus around?" |
| Student or job seeker | Low budget, unfamiliar destinations | Cheapest option, accurate fare |
| Someone in a small lane | No bus nearby | Walk or rickshaw to the nearest stop |
| Older or less tech-savvy person | Prefers speaking to typing | Voice input in Bangla |

Most users will be on Android phones with mobile data, so the site must be light and fast.

## 5. Core user flow

1. User opens the website. The purpose is clear immediately: "কোন বাসে যাবেন?"
2. User enters From and To by typing, speaking, or tapping "use my location".
3. The system finds the nearest stop to the user's starting point.
4. The user sees how to reach that stop: walk, or take a rickshaw, with a small fixed map.
5. The user sees the bus options, the fare, and any recent "bus seen" reports.
6. At the stop, the user can tap "I just saw this bus here" when a bus passes.
7. After the trip, the user can tap "I took this bus", and later answer "How much did you pay?"

## 6. Features

### 6.1 Headline feature: "Bus seen" (rider reports)

There is no live bus data, so riders become the tracker.

- At any stop or on any result, a user can tap **"I just saw this bus here"** and pick the bus.
- Other users then see: "Seen at Farmgate 6 minutes ago".
- A report is shown only for a short time (suggested: 30 minutes) and then disappears. After that the site goes back to "usually every 10 to 15 minutes".
- When there are no recent reports, the site says nothing about live buses. It never invents or guesses an arrival time.
- The report stores only the bus, the stop, and the time. It does not store the user's position.

How we keep it trustworthy:
- Show a report only when it passes simple checks: the bus actually serves that stop, and the same device hasn't sent too many reports.
- Show the count when more than one person reports ("Seen by 3 riders in the last 15 minutes").
- Rate-limit each device and ignore repeated taps.
- Add a "wrong report" button.

The honest catch: this only works once enough people use the site. At the start it will mostly be empty, so the main screen must never depend on it.

### 6.2 MVP (version 1)

| # | Feature | Details |
| --- | --- | --- |
| 1 | Trip search | From and To fields with place suggestions in Bangla and English |
| 2 | Nearest stop guide | Walk or rickshaw to the nearest stop (see 6.3) |
| 3 | Bus results | Direct buses, and options with one change when no direct bus exists |
| 4 | Official fare | Calculated from distance and the current government rate |
| 5 | Wait and trip time | "Usually every 10 to 15 minutes" and an estimated trip time |
| 6 | Bus seen | Rider reports with expiry (see 6.1) |
| 7 | Voice input | Browser speech recognition for Bangla, with a typed fallback |
| 8 | Use my location | Optional. Never required. Never stored |
| 9 | Fixed map | A small map that shows the user's spot, the stop, and the walking line (see 6.3) |
| 10 | Rider fare feedback | "How much did you pay?" with one-tap amounts |
| 11 | Report a problem | "Wrong info? Tell us" on every result |
| 12 | Confidence label | Each route is marked Verified or Not yet verified, with a last-checked date |
| 13 | Landing page | One clear purpose, shown on open (see `dhaka-bus-guide.html`) |

### 6.3 "From any lane": walk or rickshaw, plus a fixed map

**Idea:** a user can be on any road or lane, such as a street inside Bashundhara or Mirpur where no bus runs. The site finds the nearest bus stop or main road and tells them how to get there.

**You don't need to hard-code every lane.** Free map data (OpenStreetMap) already knows most roads and lanes. We hard-code only the bus information (stops and routes) and a short list of local hints.

**Rule for the first leg**
1. Find the user's starting point on the map data.
2. Find the nearest stop that has useful buses.
3. Measure the walking distance.
4. Choose what to say:
   - Short distance (suggested threshold: about 500 m, to be tuned): "Walk about 6 minutes to Mirpur 10 stop."
   - Longer: "Take a rickshaw to Mirpur 10, about 10 minutes."
5. Then show the normal bus result from that stop.

**Rickshaw prices**
- There is no official rickshaw fare, and prices are negotiated.
- Show a rough range, clearly marked "estimate". The ranges come from rider reports over time. Do not publish numbers until we have some.
- Never present a rickshaw price as a promise.

**Hand-written hints**
- Map data is good on main roads but patchy on small lanes in some areas.
- For the busiest neighborhoods, keep a short hand-written list, for example "From Road 36, go to the main road and wait at X stop."
- These hints can grow from user reports.

**The fixed map**
- It is a normal map picture, not a live map. No bus positions, no traffic.
- It shows three things only: where the user is, the nearest stop, and the walking line. Nothing else.
- It stays small and secondary, so the first screen stays minimal.
- Map data comes from OpenStreetMap and must show the required credit: "© OpenStreetMap contributors".
- The public OpenStreetMap map servers have usage limits and are not meant for heavy use. For a free setup, host a small Dhaka-only map file ourselves on free hosting (for example, a Protomaps file). Check file size and traffic limits of the host before launch.

### 6.4 Version 2

- Metro (MRT-6) as a travel option, with verified fares and station links.
- Rider-reported fare ranges shown beside the official fare for every route.
- Rickshaw estimate ranges built from rider reports.
- Saved places such as Home and Work, stored only on the user's own phone.
- "Is a bus still running?" warnings for late-night trips, using operating hours.

### 6.5 Later

- Other Bangladeshi cities.
- Offline mode for saved routes.
- A public, open route dataset for others to build on.

## 7. How results are produced

### 7.1 Finding the route
1. Match the user's From and To to the nearest stops in our own stop list, using Bangla and English names and aliases (for example "Mirpur 10", "মিরপুর ১০").
2. Build a graph where stops are nodes and each bus route connects its stops in order.
3. Search for the best option: direct routes first, then routes with one change. Rank by fewest changes, then trip time and fare.
4. For each option, find the boarding stop, the get-off stop, and the distance travelled.

This is a standard graph search. **No AI model training is needed.**

### 7.2 Fare calculation
- Fare = distance travelled × the current government rate per km, never below the minimum fare.
- As of the government gazette of 23 September 2026:
  - Buses in Dhaka and Chattogram: **Tk 2.70 per km**
  - Minibuses in Dhaka and Chattogram, and buses and minibuses under DTCA areas: **Tk 2.60 per km**
  - Minimum fare: **Tk 10 for buses, Tk 8 for minibuses**
- The rate changes with fuel prices. It was raised in April 2026 and again in September 2026. So the rate and minimums must live in one editable setting, not in the code.
- Open question: how the final fare is rounded in practice. This needs checking with riders before launch.
- Fare charts posted inside buses may show a different price. The app always labels its number "official fare".

### 7.3 Role of AI
- Not needed for route finding, fares, or the map.
- Optional and small: understanding messy place names, such as spelling variations or Banglish ("Mirpur 10 theke Uttara").
- A plain alias list is enough at the start. A free-tier language model call can be added later.

### 7.4 Voice
- Use the browser's built-in speech recognition (Bangla, `bn-BD`), which is free.
- Supported mainly in Chrome on Android. Always keep typing as a fallback.
- Parse phrases like "X theke Y" or "X থেকে Y" into From and To.

## 8. Data

### 8.1 What we need
- **Buses:** name, company, service type (local, AC, minibus), operating hours, ordered stops, and approximate frequency.
- **Stops:** Bangla and English names, aliases, and coordinates.
- **Map data:** Dhaka roads and lanes from OpenStreetMap.
- **Fare settings:** rate per km and minimum fares.
- **Rider data:** bus seen reports, fares paid, and problem reports.

### 8.2 Sources

| Source | What it gives | Concerns |
| --- | --- | --- |
| dhakabusservice.com | Over 100 bus pages with ordered stops, counters, hours, and service type | Community-collected, last updated November 2024, and it is their copyrighted work. Ask permission through their contact form, or use only as a guide and verify ourselves |
| Mendeley dataset "Shortest Route Analysis of Dhaka City Roads" (2020) | Dhaka bus route network and bus stands as map data | Old, licence unclear |
| DTCA and BRTA announcements | Fare rates, rationalised routes, Dhaka Nagar Paribahan routes | Not a full, current list |
| OpenStreetMap | Roads, lanes, many stops, walking paths | Free, but small-lane and bus stop coverage is patchy |
| Rider reports and our own checking | Verification, fares paid, bus sightings | Slow to build, but the best source of truth |

### 8.3 Reality of the data
- There is **no real-time data we control**. The only "live" signal is rider reports, and it may be empty.
- Route information goes out of date quickly. Every route shows a "last checked" date.
- Start with the 30 to 50 busiest routes, check them by riding or asking riders, then grow.

### 8.4 Data model (simplified)

```
stops         (id, name_bn, name_en, aliases[], lat, lng)
routes        (id, name_bn, name_en, company, service_type, hours, frequency_min, frequency_max, verified, last_checked)
route_stops   (route_id, stop_id, sequence)
area_hints    (id, area_name, hint_text_bn, hint_text_en, nearest_stop_id)
settings      (key, value)               -- fare rate per km, minimum fares, walk threshold
bus_seen      (id, route_id, stop_id, created_at, device_hash)
fare_reports  (id, route_id, from_stop, to_stop, amount, created_at, device_hash)
route_flags   (id, route_id, note, created_at)
```

## 9. Rider feedback

### 9.1 Fare feedback
- After a result, the user taps "I took this bus". When the expected trip time has passed, the site asks "How much did you pay?" with one-tap amounts and a skip option. A website cannot detect drop-off by itself, so this timed prompt replaces a drop-off pop-up.
- Reports are anonymous and need no login.
- To block troll or mistaken entries:
  - Show rider fares only after several reports for the same trip (suggested minimum: 5).
  - Show a middle range (for example the 25th to 75th percentile), not the highest or lowest.
  - Ignore amounts far outside a sensible range for the distance.
  - Limit how many reports one device can send per day.
- Display: "Official fare Tk 38. Riders usually paid Tk 38 to 50."
- The same prompt can ask "Was this route correct?" to improve route data.

### 9.2 Bus seen reports
See section 6.1.

## 10. Privacy and trust

- No accounts, no ads, no selling data.
- Location is optional. It is processed on the user's phone and is not stored on our servers.
- Bus seen reports store the bus, the stop, and the time. They do not store where the user is.
- Fare reports store the amount, trip, and time. No names, phone numbers, or exact locations.
- A hashed device value is kept only to limit spam.
- A plain-language privacy note on the site, in Bangla and English.
- Clear labels: "official fare", "rider reported", "estimate", "not yet verified".

## 11. Technical approach

| Layer | Choice | Cost |
| --- | --- | --- |
| Frontend | Static HTML, CSS, and JavaScript (mobile first) | Free |
| Hosting | Cloudflare Pages or Netlify free tier | Free |
| Database | Supabase free tier | Free |
| Map display | Leaflet or MapLibre with a self-hosted Dhaka map file from OpenStreetMap data | Free, check host limits |
| Walking distance and time | Computed from the same map data, or a free routing service with usage limits | Free, check limits |
| Voice | Browser speech recognition | Free |
| Domain | `.com` or `.com.bd` | About 1,200 to 1,500 BDT per year |

Notes:
- Use our own stop list for place search instead of heavy use of public search services, which have usage limits.
- Keep the site light: target a fast first load on slow mobile data. Load the map only when the user opens it.
- Free tiers can pause or limit use. Plan a simple backup of the data (export the tables regularly).
- Bus seen reports expire, so old rows can be deleted automatically to stay within free storage limits.

## 12. Cost

| Item | First year |
| --- | --- |
| Domain | 1,200 to 1,500 BDT |
| Hosting, database, map files | 0 BDT (free tiers) |
| Optional AI calls for place names | 0 BDT at first, a few hundred BDT per month at most if usage grows |
| **Total** | **About 1,500 BDT, within the 5,000 BDT budget** |

Running cost stays near zero until usage reaches tens of thousands of users. At that point, a paid database tier may be needed. The main real cost is **time** spent collecting and checking routes.

## 13. Success measures

- **Usefulness:** share of searches that return at least one result (target: 80% on covered areas).
- **Accuracy:** share of "was this route correct?" answers that say yes (target: 85%).
- **Fare feedback:** share of results that get a fare report (target: 10%).
- **Bus seen:** number of reports per day, and share of popular stops with a report in the last 30 minutes during rush hour.
- **Coverage:** number of verified routes (target: 50 in the first phase).
- **First leg:** share of "from any lane" searches that end with a stop suggestion.
- **Speed:** result shown in under 3 seconds on a typical mobile connection.
- **Trust signals:** "Wrong info" reports fixed within a week.

## 14. Risks and how to handle them

| Risk | Impact | Response |
| --- | --- | --- |
| Routes out of date | Users go to the wrong place | "Last checked" dates, confidence labels, report button |
| Incomplete data | "We don't have this trip" | Honest message, grow coverage from searches nobody could complete |
| Bus seen is empty at the start | Feature feels useless | Never depend on it, show it only when reports exist, and seed it with early users in a few busy stops |
| False or spam bus seen reports | Users wait for buses that aren't coming | Expiry, rate limits, stop and route checks, count of reporters |
| No live tracking | Wait times can be wrong | Say "usually every X minutes", never promise arrival times |
| Weak lane data in OpenStreetMap | Wrong first-leg guidance | Hand-written hints for busy areas, walking limit, report button |
| Rickshaw price disputes | Users feel misled | Mark as estimate, use rider-reported ranges only |
| Fares charged above the official rate | Users feel the app is wrong | Show official fare and rider-reported range side by side |
| Fare rules change with fuel prices | Wrong fares | One editable setting; check after each government announcement |
| Troll or false fare reports | Bad fare ranges | Minimum report count, percentile ranges, rate limits |
| Copying others' data | Legal and trust problems | Ask permission, credit sources, verify ourselves |
| Voice recognition errors in Bangla | Wrong places | Typed fallback and a confirm step |
| Free tier limits | Site slowdown or pause | Monitor usage, keep backups, plan an upgrade |
| Map file too large for free hosting | Map won't load | Cover only the Dhaka area, load the map on demand, check limits |

## 15. Roadmap

| Phase | What | Outcome |
| --- | --- | --- |
| 0. Prepare | Contact dhakabusservice.com for permission, confirm current fare rules, pick the first areas | Clear data plan |
| 1. Data | Enter and verify 30 to 50 routes in the busiest corridors (for example Mirpur, Uttara, Motijheel, Farmgate, Gulshan, Jatrabari) | A trustworthy starter dataset |
| 2. MVP | Connect the landing page to real data: search, nearest stop guide, fare calculation, voice, feedback buttons | Public beta |
| 3. Bus seen | Add the rider report feature, seeded at a few busy stops | First rider-powered signal |
| 4. Learn | Release to a small group, watch failed searches, fix routes and hints | Better coverage and accuracy |
| 5. Grow | Metro, rider fare ranges, rickshaw estimates, late-night warnings | Version 2 |

## 16. Open questions

1. Will dhakabusservice.com allow us to use their route information?
2. How is the final fare rounded in practice, and how do conductors handle short distances?
3. What are the current metro fares and station connections that should be included?
4. How much of OpenStreetMap's lane and bus stop data in Dhaka is good enough to use directly?
5. What walking distance should switch the advice from "walk" to "take a rickshaw"?
6. How long should a bus seen report stay visible, and how many reporters should be needed?
7. Which areas should be covered first, and who will help verify routes on the ground?
8. What name and domain should the site use?

## 17. Copy and tone

- Plain, friendly, and short. Bangla first where it fits, English alongside.
- Say what happens, not what the system does ("Find bus", not "Submit").
- Be honest about limits: "Usually every 10 to 15 minutes", "Estimate", "Not yet verified", "We don't have this trip yet."
- Errors say what went wrong and what to do next.

## 18. Related files

- `dhaka-bus-guide.html`: the landing page prototype, with demo data only.
- `Dhaka-Bus-Guide-PRD.md`: the earlier version of this document.
