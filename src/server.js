import "dotenv/config";
import express from "express";
import { searchLocations, amadeusEnv } from "./amadeus.js";
import { searchFlights } from "./flights.js";
import { q } from "./db.js";
import { statsForTracked } from "./stats.js";
import { startPoller, runPollOnce } from "./poller.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    amadeusEnv: amadeusEnv(),
    snapshots: q.snapshotCount.get().n,
  });
});

/** Airport & city autocomplete: /api/locations?query=syd */
app.get(
  "/api/locations",
  asyncRoute(async (req, res) => {
    const query = String(req.query.query || "").trim();
    if (query.length < 2) return res.json({ locations: [] });
    res.json({ locations: await searchLocations(query) });
  })
);

/**
 * Flight + availability search:
 * /api/flights?origin=SYD&dest=MEL&date=2026-08-15
 * origin/dest accept airport codes or Amadeus city codes (SYD, LON, TYO...).
 */
app.get(
  "/api/flights",
  asyncRoute(async (req, res) => {
    const origin = String(req.query.origin || "").toUpperCase();
    const dest = String(req.query.dest || "").toUpperCase();
    const date = String(req.query.date || "");
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest)) {
      return res.status(400).json({ error: "origin and dest must be 3-letter IATA codes" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    }
    const flights = await searchFlights({ origin, dest, date });
    res.json({ origin, dest, date, count: flights.length, flights });
  })
);

/** Start tracking a flight line so the poller builds history for it. */
app.post(
  "/api/track",
  asyncRoute(async (req, res) => {
    const { carrier = "QF", number, origin, dest } = req.body || {};
    const flightNumber = String(number || "").replace(/^\D+/, ""); // 'QF401' → '401'
    if (!flightNumber || !/^[A-Z]{3}$/i.test(origin || "") || !/^[A-Z]{3}$/i.test(dest || "")) {
      return res.status(400).json({ error: "need number, origin (IATA), dest (IATA)" });
    }
    const row = {
      carrier: String(carrier).toUpperCase(),
      flight_number: flightNumber,
      origin: String(origin).toUpperCase(),
      dest: String(dest).toUpperCase(),
    };
    q.insertTracked.run(row);
    const tracked = q.findTracked.get(row.carrier, row.flight_number, row.origin, row.dest);
    res.status(201).json({ tracked });
  })
);

app.get("/api/track", (req, res) => {
  res.json({ tracked: q.getTracked.all() });
});

app.delete("/api/track/:id", (req, res) => {
  q.deleteTracked.run(Number(req.params.id));
  res.json({ ok: true });
});

/** Historical curve + likelihood for a tracked flight. */
app.get("/api/stats/:id", (req, res) => {
  const stats = statsForTracked(Number(req.params.id));
  if (!stats) return res.status(404).json({ error: "no such tracked flight" });
  res.json(stats);
});

/** Kick a poll run manually (useful in dev; consider auth before exposing). */
app.post(
  "/api/poll",
  asyncRoute(async (req, res) => {
    res.json(await runPollOnce());
  })
);

// Central error handler — Amadeus errors surface with useful detail.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message, amadeus: err.amadeus });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Upgrade backend listening on http://localhost:${PORT} (Amadeus: ${amadeusEnv()})`);
  if (process.env.POLLER_ENABLED !== "false") startPoller();
});
