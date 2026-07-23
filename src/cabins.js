// Booking-class → cabin mapping, tuned for Qantas.
//
// NOTE: verify these against current Qantas fare-class usage before relying
// on them — airlines shuffle letters occasionally, and award/upgrade classes
// in particular are worth confirming (e.g. on the Qantas agents site or
// frequent-flyer communities). Everything below is configuration, not code.

export const CABIN_ORDER = ["First", "Business", "Premium Economy", "Economy"];

export const CABIN_OF_CLASS = {
  F: "First", A: "First",
  J: "Business", C: "Business", D: "Business", I: "Business",
  W: "Premium Economy", R: "Premium Economy", T: "Premium Economy",
  Y: "Economy", B: "Economy", H: "Economy", K: "Economy", M: "Economy",
  L: "Economy", V: "Economy", S: "Economy", N: "Economy", Q: "Economy",
  O: "Economy", G: "Economy", E: "Economy",
  // Classes commonly associated with award / Classic Reward inventory:
  P: "First",
  U: "Business",
  X: "Economy",
};

// Which class per cabin we treat as the award/Classic Reward indicator.
export const AWARD_CLASS_OF_CABIN = {
  First: "P",
  Business: "U",
  "Premium Economy": "T",
  Economy: "X",
};

/**
 * Turn an Amadeus availabilityClasses array
 * (e.g. [{class:"J", numberOfBookableSeats:9}, ...])
 * into cabin summaries the frontend can render directly.
 */
export function groupClassesIntoCabins(availabilityClasses = []) {
  const byCabin = new Map();
  for (const ac of availabilityClasses) {
    const cls = ac.class;
    const seats = ac.numberOfBookableSeats ?? 0;
    const cabin = CABIN_OF_CLASS[cls] ?? "Economy";
    if (!byCabin.has(cabin)) byCabin.set(cabin, []);
    byCabin.get(cabin).push({ cls, seats });
  }

  const cabins = [];
  for (const cabin of CABIN_ORDER) {
    const classes = byCabin.get(cabin);
    if (!classes) continue;
    const awardCls = AWARD_CLASS_OF_CABIN[cabin];
    const award = classes.find((c) => c.cls === awardCls)?.seats ?? 0;
    const sellable = classes.filter((c) => c.cls !== awardCls);
    const open = Math.max(0, ...sellable.map((c) => c.seats));
    cabins.push({
      cabin,
      classes,
      open,
      award,
      gds: classes.map((c) => `${c.cls}${Math.min(c.seats, 9)}`).join(" "),
    });
  }
  return cabins;
}

/** ISO-8601 duration ("PT14H35M") → minutes. */
export function isoDurationToMinutes(iso) {
  if (!iso) return null;
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return null;
  return (Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3] || 0);
}
