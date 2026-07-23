import cron from "node-cron";
import { flightAvailabilities } from "./amadeus.js";
import { groupClassesIntoCabins } from "./cabins.js";
import { db, q } from "./db.js";

// Which "days out" to sample for every tracked flight on each poll run.
// These become the x-axis of the historical availability curve.
const OFFSETS = (process.env.POLL_OFFSETS || "1,3,5,7,10,14,21,30,45,60")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n >= 0);

const DELAY_MS = Number(process.env.POLL_DELAY_MS || 1200); // stay polite on rate limits

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dateAtOffset(days) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Poll one tracked flight at one departure date; write one snapshot row per cabin. */
async function pollOne(tracked, daysOut) {
  const departureDate = dateAtOffset(daysOut);
  const avail = await flightAvailabilities({
    origin: tracked.origin,
    dest: tracked.dest,
    date: departureDate,
  });

  const seg = avail
    .filter((i) => i.segments?.length === 1)
    .map((i) => i.segments[0])
    .find((s) => s.carrierCode === tracked.carrier && String(s.number) === String(tracked.flight_number));

  if (!seg) return { found: false, departureDate };

  const cabins = groupClassesIntoCabins(seg.availabilityClasses);
  const insert = db.transaction(() => {
    for (const c of cabins) {
      q.insertSnapshot.run({
        tracked_id: tracked.id,
        departure_date: departureDate,
        days_out: daysOut,
        cabin: c.cabin,
        open_seats: c.open,
        award_seats: c.award,
        gds: c.gds,
      });
    }
  });
  insert();
  return { found: true, departureDate, cabins: cabins.length };
}

/** One full pass over every tracked flight × every offset. */
export async function runPollOnce() {
  const tracked = q.getTracked.all();
  const summary = { tracked: tracked.length, calls: 0, snapshots: 0, misses: 0, errors: 0 };
  console.log(`[poller] run start: ${tracked.length} tracked flight(s), offsets [${OFFSETS.join(", ")}]`);

  for (const t of tracked) {
    for (const daysOut of OFFSETS) {
      try {
        const res = await pollOne(t, daysOut);
        summary.calls++;
        if (res.found) summary.snapshots += res.cabins;
        else summary.misses++;
      } catch (e) {
        summary.errors++;
        console.warn(`[poller] ${t.carrier}${t.flight_number} ${t.origin}-${t.dest} @+${daysOut}d: ${e.message}`);
        if (e.status === 429) {
          console.warn("[poller] rate limited — backing off 30s");
          await sleep(30_000);
        }
      }
      await sleep(DELAY_MS);
    }
  }

  console.log(
    `[poller] run done: ${summary.calls} calls, ${summary.snapshots} snapshot rows, ` +
      `${summary.misses} dates without the flight, ${summary.errors} errors`
  );
  return summary;
}

/** Schedule recurring polls (default: every 6 hours). */
export function startPoller() {
  const schedule = process.env.POLL_CRON || "0 */6 * * *";
  if (!cron.validate(schedule)) {
    console.warn(`[poller] invalid POLL_CRON '${schedule}' — poller disabled`);
    return;
  }
  cron.schedule(schedule, () => {
    runPollOnce().catch((e) => console.error("[poller] run failed:", e));
  });
  console.log(`[poller] scheduled with cron '${schedule}'`);
}
