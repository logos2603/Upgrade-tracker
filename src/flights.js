import { flightOffers, flightAvailabilities } from "./amadeus.js";
import { groupClassesIntoCabins, isoDurationToMinutes } from "./cabins.js";

const AIRLINE = process.env.AIRLINE_CODE || "QF";
const CURRENCY = process.env.CURRENCY || "AUD";

/**
 * Search a route/date and return flights in the shape the frontend expects:
 * number, times, aircraft, price, and cabins[] with per-class seat counts.
 *
 * Makes two Amadeus calls (offers for price, availabilities for seats) and
 * merges them on carrier+number+departure time. Availability results without
 * a matching offer are still returned (price: null) — sandbox price coverage
 * is patchier than availability coverage.
 */
export async function searchFlights({ origin, dest, date }) {
  const [avail, offers] = await Promise.all([
    flightAvailabilities({ origin, dest, date }),
    flightOffers({ origin, dest, date, airline: AIRLINE, currency: CURRENCY }).catch((e) => {
      // Price data is nice-to-have; don't fail the whole search over it.
      console.warn("flight-offers failed:", e.message);
      return [];
    }),
  ]);

  // Index cheapest offer per flight.
  const priceByFlight = new Map();
  for (const offer of offers) {
    const seg = offer.itineraries?.[0]?.segments?.[0];
    if (!seg || offer.itineraries?.[0]?.segments?.length !== 1) continue;
    const key = `${seg.carrierCode}${seg.number}|${seg.departure?.at}`;
    const total = Number(offer.price?.grandTotal ?? offer.price?.total ?? NaN);
    if (!Number.isFinite(total)) continue;
    const prev = priceByFlight.get(key);
    if (!prev || total < prev.total) {
      priceByFlight.set(key, { total, currency: offer.price?.currency ?? CURRENCY });
    }
  }

  const flights = [];
  for (const item of avail) {
    if (item.segments?.length !== 1) continue; // non-stop only, matching the UI
    const seg = item.segments[0];
    if (seg.carrierCode !== AIRLINE) continue;

    const key = `${seg.carrierCode}${seg.number}|${seg.departure?.at}`;
    flights.push({
      id: `${seg.carrierCode}${seg.number}-${seg.departure?.at}`,
      number: `${seg.carrierCode}${seg.number}`,
      carrier: seg.carrierCode,
      flightNumber: seg.number,
      aircraft: seg.aircraft?.code ?? null,
      departure: { airport: seg.departure?.iataCode, at: seg.departure?.at },
      arrival: { airport: seg.arrival?.iataCode, at: seg.arrival?.at },
      durationMinutes: isoDurationToMinutes(item.duration ?? seg.duration),
      price: priceByFlight.get(key) ?? null,
      cabins: groupClassesIntoCabins(seg.availabilityClasses),
    });
  }

  flights.sort((a, b) => String(a.departure.at).localeCompare(String(b.departure.at)));
  return flights;
}
