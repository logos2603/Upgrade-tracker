import { q } from "./db.js";

const NEAR_DEPARTURE_DAYS = Number(process.env.NEAR_DEPARTURE_DAYS || 7);

/**
 * Build the historical picture for one tracked flight:
 * per cabin, the average seats open at each sampled days-out,
 * plus "of the departures we observed inside N days, what share
 * still had an open seat / an award seat".
 *
 * Honesty rule: likelihoods are only reported once there are at
 * least MIN_SAMPLE distinct departures; below that the curve is
 * returned but the percentage is null.
 */
const MIN_SAMPLE = Number(process.env.MIN_SAMPLE || 10);

export function statsForTracked(trackedId) {
  const tracked = q.getTrackedById.get(trackedId);
  if (!tracked) return null;

  const cabins = q.cabinsForTracked.all(trackedId).map((r) => r.cabin);
  const out = {
    tracked: {
      id: tracked.id,
      flight: `${tracked.carrier}${tracked.flight_number}`,
      origin: tracked.origin,
      dest: tracked.dest,
    },
    nearDepartureWindowDays: NEAR_DEPARTURE_DAYS,
    minSample: MIN_SAMPLE,
    cabins: [],
  };

  for (const cabin of cabins) {
    const curve = q.snapshotCurve.all(trackedId, cabin).map((r) => ({
      daysOut: r.days_out,
      avgOpenSeats: Number(r.avg_open.toFixed(2)),
      avgAwardSeats: Number(r.avg_award.toFixed(2)),
      samples: r.samples,
    }));

    const near = q.likelihoodNearDeparture.get(trackedId, cabin, NEAR_DEPARTURE_DAYS);
    const enough = near.total >= MIN_SAMPLE;

    out.cabins.push({
      cabin,
      curve,
      departuresObservedNearDeparture: near.total,
      likelihood: enough
        ? {
            seatOpenPct: Math.round((near.open_ok / near.total) * 100),
            awardOpenPct: Math.round((near.award_ok / near.total) * 100),
          }
        : null,
    });
  }

  return out;
}
