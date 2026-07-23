import React, { useState, useEffect, useRef, useCallback } from "react";

/* ============================================================
   THE POINTY END — live frontend
   Talks to the backend API:
     GET  /api/locations?query=
     GET  /api/flights?origin&dest&date
     GET  /api/track   POST /api/track   DELETE /api/track/:id
     GET  /api/stats/:id
   ============================================================ */

async function api(path, opts) {
  const res = await fetch(path, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

const AIRCRAFT_NAMES = {
  "73H": "B737-800", 738: "B737-800", 739: "B737-900",
  332: "A330-200", 333: "A330-300",
  388: "A380-800", 788: "B787-8", 789: "B787-9",
  "32N": "A321neo", "32Q": "A321neo", 320: "A320", 321: "A321",
  221: "A220-100", 223: "A220-300", DH4: "Dash 8 Q400", E90: "E190",
};

const fmtAircraft = (code) => (code ? AIRCRAFT_NAMES[code] || code : "");
const fmtTime = (iso) => (iso ? iso.slice(11, 16) : "—");
const fmtDur = (mins) =>
  mins == null ? "" : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
const overnight = (f) =>
  f.departure?.at && f.arrival?.at && f.arrival.at.slice(0, 10) > f.departure.at.slice(0, 10);

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ---------- airport / city picker (live autocomplete) ---------- */

function AirportPicker({ label, value, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounced(query, 300);
  const seq = useRef(0);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const mySeq = ++seq.current;
    setLoading(true);
    api(`/api/locations?query=${encodeURIComponent(q)}`)
      .then((json) => {
        if (seq.current === mySeq) setResults(json.locations);
      })
      .catch(() => seq.current === mySeq && setResults([]))
      .finally(() => seq.current === mySeq && setLoading(false));
  }, [debounced]);

  const display = value
    ? value.type === "city"
      ? `${value.city} (${value.code} — all airports)`
      : `${value.code} — ${value.name}`
    : "";

  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="text"
        value={open ? query : display}
        placeholder="City or airport"
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (query.trim().length >= 2 || loading) && (
        <div className="dropdown" role="listbox">
          {loading && <div className="dd-empty">Searching…</div>}
          {!loading && results.length === 0 && <div className="dd-empty">No matches</div>}
          {results.map((r, i) => (
            <button
              type="button"
              key={r.type + r.code + i}
              className={`dd-item ${r.type === "city" ? "dd-city" : ""}`}
              onMouseDown={() => {
                onChange(r);
                setOpen(false);
              }}
            >
              <span className="dd-code">{r.code}</span>
              <span>
                {r.type === "city" ? `${r.city} — all airports` : `${r.name}, ${r.city}`}
                {r.country ? `, ${r.country}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- availability widgets ---------- */

function SeatDots({ n }) {
  return (
    <span className="dots" aria-label={`${n} seats open`}>
      {Array.from({ length: 9 }).map((_, i) => (
        <i key={i} className={i < n ? "on" : ""} />
      ))}
    </span>
  );
}

function CurveSparkline({ curve }) {
  // curve: [{daysOut, avgOpenSeats}] — plot far-out (left) → departure (right)
  const pts = [...curve].sort((a, b) => b.daysOut - a.daysOut);
  if (pts.length < 2) return null;
  const w = 180, h = 44;
  const max = Math.max(4, ...pts.map((p) => p.avgOpenSeats));
  const coords = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * (w - 8) + 4;
    const y = h - 8 - (p.avgOpenSeats / max) * (h - 16);
    return { x, y };
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" aria-hidden="true">
      <polyline
        points={coords.map((c) => `${c.x},${c.y}`).join(" ")}
        fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinecap="round"
      />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r="1.8" fill="var(--amber)" />
      ))}
    </svg>
  );
}

const CABIN_TONES = { First: "gold", Business: "red", "Premium Economy": "teal", Economy: "grey" };
const CABIN_SHORT = { First: "F", Business: "J", "Premium Economy": "W", Economy: "Y" };

function CabinCard({ c, statsCabin, minSample }) {
  const state = c.open >= 4 ? "wide" : c.open >= 1 ? "tight" : "closed";
  const stateLabel = state === "wide" ? "Wide open" : state === "tight" ? "Limited" : "Sold out";
  return (
    <div className={`cabin cabin-${state}`}>
      <div className="cabin-head">
        <span className={`cabin-chip tone-${CABIN_TONES[c.cabin] || "grey"}`}>
          {CABIN_SHORT[c.cabin] || "?"}
        </span>
        <span className="cabin-name">{c.cabin}</span>
        <span className={`cabin-state st-${state}`}>{stateLabel}</span>
      </div>

      <div className="cabin-row">
        <span className="lbl">Seats open now</span>
        <SeatDots n={Math.min(c.open, 9)} />
        <span className="num">{c.open >= 9 ? "9+" : c.open}</span>
      </div>

      <div className="cabin-row">
        <span className="lbl">Fare buckets</span>
        <span className="gds">{c.gds}</span>
      </div>

      <div className="cabin-row">
        <span className="lbl">Award / reward class</span>
        <span className={`award ${c.award > 0 ? "yes" : "no"}`}>
          {c.award > 0 ? `${c.award} seat${c.award > 1 ? "s" : ""}` : "None"}
        </span>
      </div>

      {statsCabin && (
        <div className="cabin-history">
          <div className="hist-top">
            <span className="lbl">Avg seats open by days-out</span>
            {statsCabin.likelihood ? (
              <span className="pct">{statsCabin.likelihood.seatOpenPct}%</span>
            ) : (
              <span className="pct pct-dim">—</span>
            )}
          </div>
          <CurveSparkline curve={statsCabin.curve} />
          <div className="hist-note">
            {statsCabin.likelihood
              ? `Share of tracked departures with a seat still open in the final week · ${statsCabin.departuresObservedNearDeparture} departures observed`
              : `Collecting data — ${statsCabin.departuresObservedNearDeparture}/${minSample} departures observed near departure before odds are shown`}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- flight row ---------- */

function FlightRow({ f, expanded, onToggle, trackedEntry, onTrack, onUntrack }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (expanded && trackedEntry) {
      api(`/api/stats/${trackedEntry.id}`).then(setStats).catch(() => setStats(null));
    } else {
      setStats(null);
    }
  }, [expanded, trackedEntry]);

  const upgradeCabins = f.cabins.length > 1 ? f.cabins.slice(0, -1) : [];
  const bestOpen = Math.max(0, ...upgradeCabins.map((c) => c.open));
  const anyAward = upgradeCabins.some((c) => c.award > 0);

  return (
    <div className={`flight ${expanded ? "expanded" : ""}`}>
      <button className="flight-main" onClick={onToggle} aria-expanded={expanded}>
        <span className="f-num">{f.number}</span>
        <span className="f-times">
          <b>{fmtTime(f.departure.at)}</b> {f.departure.airport} → <b>{fmtTime(f.arrival.at)}</b>{" "}
          {f.arrival.airport}
          {overnight(f) && <sup>+1</sup>}
        </span>
        <span className="f-meta">
          {fmtDur(f.durationMinutes)}
          {f.aircraft ? ` · ${fmtAircraft(f.aircraft)}` : ""}
        </span>
        <span className="f-badges">
          {upgradeCabins.length === 0 ? (
            <span className="badge b-none">Single cabin</span>
          ) : bestOpen > 0 ? (
            <span className="badge b-open">{bestOpen >= 9 ? "9+" : bestOpen} premium seats</span>
          ) : (
            <span className="badge b-none">Premium full</span>
          )}
          {anyAward && <span className="badge b-award">Reward space</span>}
          {trackedEntry && <span className="badge b-tracked">Tracking</span>}
        </span>
        <span className="f-price">
          {f.price ? (
            <>
              <small>from</small> ${Number(f.price.total).toLocaleString()}
              <small> {f.price.currency}</small>
            </>
          ) : (
            <small>price n/a</small>
          )}
        </span>
        <span className="f-caret">{expanded ? "–" : "+"}</span>
      </button>

      {expanded && (
        <div className="flight-detail">
          <div className="cabins">
            {f.cabins.map((c) => (
              <CabinCard
                key={c.cabin}
                c={c}
                minSample={stats?.minSample}
                statsCabin={stats?.cabins?.find((s) => s.cabin === c.cabin)}
              />
            ))}
          </div>
          <div className="detail-actions">
            <a
              className="book"
              href="https://www.qantas.com/au/en/booking/flights.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              Book {f.number} on qantas.com ↗
            </a>
            {trackedEntry ? (
              <button className="ghost" onClick={() => onUntrack(trackedEntry.id)}>
                Stop tracking
              </button>
            ) : (
              <button className="ghost" onClick={() => onTrack(f)}>
                Track this flight
              </button>
            )}
            <span className="detail-note">
              Tracked flights are polled automatically to build the historical availability curve.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- main app ---------- */

export default function App() {
  const defDate = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);

  const [origin, setOrigin] = useState(null);
  const [dest, setDest] = useState(null);
  const [date, setDate] = useState(defDate);
  const [searched, setSearched] = useState(null); // {flights, origin, dest, date}
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [tracked, setTracked] = useState([]);

  const loadTracked = useCallback(() => {
    api("/api/track").then((j) => setTracked(j.tracked)).catch(() => {});
  }, []);
  useEffect(loadTracked, [loadTracked]);

  const trackedEntryFor = (f) =>
    tracked.find(
      (t) =>
        t.carrier === f.carrier &&
        String(t.flight_number) === String(f.flightNumber) &&
        t.origin === f.departure.airport &&
        t.dest === f.arrival.airport
    );

  const runSearch = async () => {
    if (!origin || !dest || !date) return;
    setLoading(true);
    setError(null);
    setSearched(null);
    setExpandedId(null);
    try {
      const p = new URLSearchParams({ origin: origin.code, dest: dest.code, date });
      const json = await api(`/api/flights?${p}`);
      setSearched(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const track = async (f) => {
    await api("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        carrier: f.carrier,
        number: f.flightNumber,
        origin: f.departure.airport,
        dest: f.arrival.airport,
      }),
    }).catch((e) => setError(e.message));
    loadTracked();
  };

  const untrack = async (id) => {
    await api(`/api/track/${id}`, { method: "DELETE" }).catch(() => {});
    loadTracked();
  };

  const canSearch = origin && dest && date && origin.code !== dest.code && !loading;

  return (
    <div className="app">
      <header>
        <div className="mark" aria-hidden="true">▲</div>
        <div>
          <h1>The Pointy End</h1>
          <p className="tag">Qantas upgrade availability radar</p>
        </div>
      </header>

      <section className="search">
        <AirportPicker label="From" value={origin} onChange={setOrigin} />
        <AirportPicker label="To" value={dest} onChange={setDest} />
        <div className="field field-date">
          <label>Departure</label>
          <input
            type="date"
            value={date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <button className="go" onClick={runSearch} disabled={!canSearch}>
          {loading ? "Checking…" : "Check availability"}
        </button>
      </section>

      {tracked.length > 0 && (
        <div className="tracked-strip">
          <span className="lbl">Tracking:</span>
          {tracked.map((t) => (
            <span key={t.id} className="chip">
              {t.carrier}
              {t.flight_number} {t.origin}→{t.dest}
              <button aria-label="Stop tracking" onClick={() => untrack(t.id)}>×</button>
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="error">
          {error}
          {/sandbox|no such|not set/i.test(error) ? "" : " — sandbox coverage is limited; try another route or date."}
        </div>
      )}

      {!searched && !loading && !error && (
        <div className="empty">
          <p>
            Search a route to see non-stop Qantas flights with seats open in each cabin, award-class
            space, and — for flights you track — how availability historically holds up as departure
            approaches.
          </p>
        </div>
      )}

      {searched && searched.flights.length === 0 && (
        <div className="empty">
          <p>
            No non-stop QF flights returned for {searched.origin}→{searched.dest} on {searched.date}.
            The Amadeus sandbox has partial coverage — SYD→MEL is usually a safe test.
          </p>
        </div>
      )}

      {searched && searched.flights.length > 0 && (
        <section className="results">
          <div className="results-head">
            <span>
              {searched.flights.length} flight{searched.flights.length > 1 ? "s" : ""} ·{" "}
              {searched.origin} → {searched.dest} · {searched.date}
            </span>
            <span className="legend">
              <i className="lg lg-open" /> seats open <i className="lg lg-award" /> award space
            </span>
          </div>
          {searched.flights.map((f) => (
            <FlightRow
              key={f.id}
              f={f}
              expanded={expandedId === f.id}
              onToggle={() => setExpandedId(expandedId === f.id ? null : f.id)}
              trackedEntry={trackedEntryFor(f)}
              onTrack={track}
              onUntrack={untrack}
            />
          ))}
        </section>
      )}

      <footer>
        Availability sourced live via the Amadeus APIs. Open seats and award-class space are strong
        signals, not guarantees — upgrade clearance is ultimately at Qantas's discretion.
      </footer>
    </div>
  );
}
