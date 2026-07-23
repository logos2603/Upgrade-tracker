# Upgrade-tracker# Qantas Upgrade Backend

An API that answers one question: **for a given Qantas flight, are there seats open in the cabins above yours — and historically, how often does that stay true up to departure?**

It wraps the [Amadeus Self-Service APIs](https://developers.amadeus.com) for live availability, records snapshots of tracked flights over time in SQLite, and turns those snapshots into an availability curve and an upgrade-likelihood percentage.

## How it works

1. **Live search** — `/api/flights` merges two Amadeus calls: *Flight Availabilities Search* (seat counts per booking class, e.g. `J9 C4 D2 U1`) and *Flight Offers Search* (the "from $X" price). Booking classes are grouped into cabins (First / Business / Premium Economy / Economy) with the award/Classic-Reward class split out per cabin.
2. **Tracking** — `POST /api/track` registers a flight line (e.g. QF401 SYD→MEL). A cron poller then samples its availability at fixed days-out offsets (default 1, 3, 5, 7, 10, 14, 21, 30, 45, 60) and writes one snapshot row per cabin.
3. **Stats** — `/api/stats/:id` returns the average-seats-open curve by days-out, plus the share of observed departures that still had an open (or award) seat inside the final week. Percentages are withheld until at least `MIN_SAMPLE` departures have been observed, so the site never shows a "likelihood" built on three data points.

## Setup

```bash
git clone <this repo>
cd qantas-upgrade-backend
npm install
cp .env.example .env   # then paste in your Amadeus keys
npm run dev
```

Get free sandbox keys by creating a Self-Service app at [developers.amadeus.com](https://developers.amadeus.com) — the Client ID and Secret go straight into `.env`. Then open http://localhost:3000 for a built-in test page.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | Status, environment, snapshot count |
| GET | `/api/locations?query=syd` | Airport & city autocomplete (Amadeus location search) |
| GET | `/api/flights?origin=SYD&dest=MEL&date=2026-08-15` | Non-stop QF flights with price + per-cabin availability |
| POST | `/api/track` | Body `{ "number": "QF401", "origin": "SYD", "dest": "MEL" }` — start building history |
| GET | `/api/track` | List tracked flights |
| DELETE | `/api/track/:id` | Stop tracking |
| GET | `/api/stats/:id` | Historical curve + likelihood for a tracked flight |
| POST | `/api/poll` | Trigger a poll run manually (also: `npm run poll`) |

The `/api/flights` response shape matches the React prototype's flight objects (`number`, `departure`, `arrival`, `price`, `cabins[].classes/open/award/gds`), so wiring the frontend up is a matter of replacing its mock `generateFlights()` with a `fetch` to this endpoint.

## Sandbox caveats (worth reading)

- **Test data is cached and partial.** The Amadeus sandbox serves a static snapshot of real inventory. Some routes/dates return nothing, prices may be missing where availability exists, and seat counts don't move the way live inventory does — so the poller will produce *plumbing-correct* but flat history in the sandbox. The historical stats only become meaningful once you switch `AMADEUS_ENV=production` (requires signing the production agreement; you then pay per call above the free monthly quota).
- **Rate limits.** The sandbox allows roughly 10 requests/second and a monthly free quota per API. The poller spaces calls (`POLL_DELAY_MS`) and backs off on 429s. Each poll run costs `tracked flights × offsets` calls — start with a handful of routes you care about.
- **Booking-class mapping is configuration.** `src/cabins.js` maps class letters to cabins and nominates an award class per cabin (U for Business, X for Economy, etc.). Verify these against current Qantas usage before trusting the award numbers — airlines reshuffle letters, and this mapping is the one piece of the system that encodes an assumption rather than data.
- **"Seats for sale" ≠ "upgrade will clear."** Open premium seats and award-class space are strong signals, but Qantas ultimately controls how Classic Upgrade Rewards clear. Present the numbers as odds, not promises — the `MIN_SAMPLE` guard exists for exactly this reason.

## Growing it up

- **Postgres**: the schema in `src/db.js` is two tables and ports directly; swap `better-sqlite3` for `pg` when you deploy somewhere with a managed database.
- **Deployment**: any Node host works (Fly.io, Railway, a $5 VPS). Keep the poller on a single instance, or move `runPollOnce()` into a separate scheduled job (GitHub Actions cron calling `POST /api/poll`, or a worker dyno) so web scaling doesn't multiply your Amadeus bill.
- **Auth**: `/api/poll` and the track endpoints are open — add a key check before exposing this publicly.
- **Qantas click-through**: link out to qantas.com flight search; if you join the Qantas affiliate program you get sanctioned, trackable deep links.
