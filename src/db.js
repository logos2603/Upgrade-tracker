import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/upgrade.db";
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS tracked_flights (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  carrier       TEXT NOT NULL DEFAULT 'QF',
  flight_number TEXT NOT NULL,            -- e.g. '401' (digits only)
  origin        TEXT NOT NULL,            -- IATA airport code
  dest          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (carrier, flight_number, origin, dest)
);

CREATE TABLE IF NOT EXISTS snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tracked_id     INTEGER NOT NULL REFERENCES tracked_flights(id) ON DELETE CASCADE,
  departure_date TEXT NOT NULL,           -- YYYY-MM-DD
  days_out       INTEGER NOT NULL,        -- days between capture and departure
  cabin          TEXT NOT NULL,           -- First / Business / Premium Economy / Economy
  open_seats     INTEGER NOT NULL,        -- max bookable seats across sellable classes
  award_seats    INTEGER NOT NULL,        -- seats in the award/Classic Reward class
  gds            TEXT,                    -- raw availability string, e.g. 'J9 C4 D2 U1'
  captured_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tracked_id, departure_date, days_out, cabin) ON CONFLICT REPLACE
);

CREATE INDEX IF NOT EXISTS idx_snapshots_lookup
  ON snapshots (tracked_id, cabin, days_out);
`);

export const q = {
  insertTracked: db.prepare(`
    INSERT OR IGNORE INTO tracked_flights (carrier, flight_number, origin, dest)
    VALUES (@carrier, @flight_number, @origin, @dest)
  `),
  getTracked: db.prepare(`SELECT * FROM tracked_flights ORDER BY carrier, CAST(flight_number AS INTEGER)`),
  getTrackedById: db.prepare(`SELECT * FROM tracked_flights WHERE id = ?`),
  findTracked: db.prepare(`
    SELECT * FROM tracked_flights
    WHERE carrier = ? AND flight_number = ? AND origin = ? AND dest = ?
  `),
  deleteTracked: db.prepare(`DELETE FROM tracked_flights WHERE id = ?`),

  insertSnapshot: db.prepare(`
    INSERT INTO snapshots (tracked_id, departure_date, days_out, cabin, open_seats, award_seats, gds)
    VALUES (@tracked_id, @departure_date, @days_out, @cabin, @open_seats, @award_seats, @gds)
  `),
  snapshotCurve: db.prepare(`
    SELECT days_out,
           AVG(open_seats)  AS avg_open,
           AVG(award_seats) AS avg_award,
           COUNT(*)         AS samples
    FROM snapshots
    WHERE tracked_id = ? AND cabin = ?
    GROUP BY days_out
    ORDER BY days_out DESC
  `),
  likelihoodNearDeparture: db.prepare(`
    SELECT COUNT(DISTINCT departure_date) AS total,
           COUNT(DISTINCT CASE WHEN open_seats  > 0 THEN departure_date END) AS open_ok,
           COUNT(DISTINCT CASE WHEN award_seats > 0 THEN departure_date END) AS award_ok
    FROM snapshots
    WHERE tracked_id = ? AND cabin = ? AND days_out <= ?
  `),
  cabinsForTracked: db.prepare(`SELECT DISTINCT cabin FROM snapshots WHERE tracked_id = ?`),
  snapshotCount: db.prepare(`SELECT COUNT(*) AS n FROM snapshots`),
};
