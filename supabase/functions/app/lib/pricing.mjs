// Server-authoritative pricing + reference codes. Never trust browser-computed money.
import { RATES, ZONE_FEES } from "./core.mjs";

export function starterDiscount(days) {
  if (days >= 5) return 10000;
  if (days === 4) return 7000;
  if (days === 3) return 5000;
  return 0;
}

export function priceBooking(packageKey, days, zoneKey) {
  let base, discount = 0, freeDelivery = false;
  if (packageKey === "starter") {
    base = RATES.starter * days;
    discount = starterDiscount(days);
    freeDelivery = days >= 2;
  } else if (packageKey === "weekend") {
    base = RATES.weekend;
    freeDelivery = true;
  } else {
    base = RATES.night * days;
  }
  const rental = base - discount;
  const delivery = freeDelivery ? 0 : ZONE_FEES[zoneKey]; // null = agreed with rider
  return { rental, discount, delivery, total: rental + (delivery ?? 0) };
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeCode(prefix) {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return `${prefix}${code}`;
}

export const makeRef = () => makeCode("PG-");
export const makeTxnRef = () => makeCode("TXN-");
export const makeIncidentRef = () => makeCode("INC-");