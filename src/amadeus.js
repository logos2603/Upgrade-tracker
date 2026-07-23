// Minimal Amadeus Self-Service API client (no SDK, just fetch).
// Docs: https://developers.amadeus.com/self-service

const BASES = {
  test: "https://test.api.amadeus.com",
  production: "https://api.amadeus.com",
};

const ENV = process.env.AMADEUS_ENV === "production" ? "production" : "test";
const BASE = BASES[ENV];

let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken;

  const id = process.env.AMADEUS_CLIENT_ID;
  const secret = process.env.AMADEUS_CLIENT_SECRET;
  if (!id || !secret) {
    throw Object.assign(
      new Error("AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET are not set. Copy .env.example to .env and add your keys."),
      { status: 500 }
    );
  }

  const res = await fetch(`${BASE}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`Amadeus auth failed (${res.status}): ${text}`), { status: 502 });
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in ?? 1799) * 1000;
  return cachedToken;
}

async function amadeusFetch(path, { method = "GET", query, body } = {}) {
  const token = await getToken();
  const url = new URL(BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const detail = json?.errors?.map((e) => e.detail || e.title).join("; ") || text.slice(0, 300);
    throw Object.assign(new Error(`Amadeus ${method} ${path} → ${res.status}: ${detail}`), {
      status: res.status === 429 ? 429 : 502,
      amadeus: json?.errors,
    });
  }
  return json;
}

/** Airport & city autocomplete. keyword: free text ("syd", "tokyo"). */
export async function searchLocations(keyword) {
  const json = await amadeusFetch("/v1/reference-data/locations", {
    query: {
      subType: "AIRPORT,CITY",
      keyword,
      "page[limit]": 12,
      view: "LIGHT",
    },
  });
  return (json.data ?? []).map((d) => ({
    type: d.subType === "CITY" ? "city" : "airport",
    code: d.iataCode,
    name: d.name,
    city: d.address?.cityName ?? d.name,
    country: d.address?.countryName ?? "",
  }));
}

/** Priced, bookable offers for a route/date (used for the "from $X" price). */
export async function flightOffers({ origin, dest, date, airline, currency, max = 50 }) {
  const json = await amadeusFetch("/v2/shopping/flight-offers", {
    query: {
      originLocationCode: origin,
      destinationLocationCode: dest,
      departureDate: date,
      adults: 1,
      nonStop: true,
      includedAirlineCodes: airline,
      currencyCode: currency,
      max,
    },
  });
  return json.data ?? [];
}

/** Per-booking-class seat counts — the heart of the upgrade check. */
export async function flightAvailabilities({ origin, dest, date }) {
  const json = await amadeusFetch("/v1/shopping/availability/flight-availabilities", {
    method: "POST",
    body: {
      originDestinations: [
        {
          id: "1",
          originLocationCode: origin,
          destinationLocationCode: dest,
          departureDateTime: { date },
        },
      ],
      travelers: [{ id: "1", travelerType: "ADULT" }],
      sources: ["GDS"],
    },
  });
  return json.data ?? [];
}

export function amadeusEnv() {
  return ENV;
}
