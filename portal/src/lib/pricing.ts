export const RATES = { starter: 25000, weekend: 50000, night: 15000 } as const;
export type PackageKey = keyof typeof RATES;

export const ZONES: Record<string, { label: string; fee: number | null }> = {
  goba: { label: "Goba / Kimara / Ubungo", fee: 6000 },
  sinza: { label: "Sinza / Mwenge / Makumbusho / Kijitonyama", fee: 8000 },
  mbezi: { label: "Mbezi Beach / Kawe / Tegeta", fee: 8000 },
  kigamboni: { label: "Kigamboni", fee: 10000 },
  magomeni: { label: "Magomeni / Kariakoo / Kinondoni / Morocco", fee: 10000 },
  oyster: { label: "Oyster Bay / Mikocheni / Masaki", fee: 10000 },
  other: { label: "Other area (not listed)", fee: null },
};

export function starterDiscount(days: number): number {
  if (days >= 5) return 10000;
  if (days === 4) return 7000;
  if (days === 3) return 5000;
  return 0;
}

export interface Price {
  rental: number;
  discount: number;
  delivery: number | null;
  freeDelivery: boolean;
  total: number;
}

export function priceBooking(pkg: PackageKey, days: number, zoneKey: string): Price {
  let base: number;
  let discount = 0;
  let freeDelivery = false;
  if (pkg === "starter") {
    base = RATES.starter * days;
    discount = starterDiscount(days);
    freeDelivery = days >= 2;
  } else if (pkg === "weekend") {
    base = RATES.weekend;
    freeDelivery = true;
  } else {
    base = RATES.night * days;
  }
  const rental = base - discount;
  const delivery = freeDelivery ? 0 : (ZONES[zoneKey]?.fee ?? null);
  return { rental, discount, delivery, freeDelivery, total: rental + (delivery ?? 0) };
}

export const PACKAGE_META: Record<PackageKey, { name: string; per: string; blurb: string; features: string[] }> = {
  starter: {
    name: "Starter Package",
    per: "/ day",
    blurb: "Flexible day rentals with multi-day discounts.",
    features: ["1 PS5 console + 2 DualSense controllers", "5 popular games pre-installed", "3+ days: money off · 2+ days: free delivery"],
  },
  weekend: {
    name: "Weekend Package",
    per: "/ weekend",
    blurb: "Friday to Sunday at a fixed price, delivered free.",
    features: ["1 PS5 console + 2 DualSense controllers", "Up to 5 games of your choice", "Free delivery and pickup"],
  },
  night: {
    name: "Night Package",
    per: "/ night",
    blurb: "Overnight sessions, delivered at 8:00 PM.",
    features: ["1 PS5 console + 2 DualSense controllers", "Up to 5 games of your choice", "8:00 PM to 10:00 AM overnight"],
  },
};

export const GAME_LIBRARY = [
  { id: "fc27", title: "EA SPORTS FC 27", tag: "Hot release", cover: "/assets/games/ea-fc-27.jpg" },
  { id: "mw3", title: "Call of Duty: Modern Warfare III", tag: "Shooter", cover: "/assets/games/cod-mw3.jpg" },
  { id: "gta6", title: "GTA 6", tag: "Fan favourite", cover: "/assets/games/gta-6.jpg" },
  { id: "nba2k27", title: "NBA 2K27", tag: "Basketball", cover: "/assets/games/nba-2k27.jpg" },
  { id: "spiderman2", title: "Spider-Man 2", tag: "Action", cover: null },
  { id: "gow", title: "God of War Ragnarök", tag: "Recommended", cover: null },
];

export const STARTER_PRESET = ["fc27", "mw3", "gta6", "nba2k27", "spiderman2"];
