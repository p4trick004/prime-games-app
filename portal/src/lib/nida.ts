// Tanzanian NIDA NIN: 20 digits, printed as XXXXXXXX-XXXXX-XXXXX-XX.
// Hyphens and spaces are optional separators; the normalized value is always
// a string so leading zeros survive.
export const NIDA_ERROR = "Enter a valid NIDA number — 20 digits, hyphens optional.";

export function normalizeNida(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

export function isValidNida(raw: string): boolean {
  return /^\d{20}$/.test(normalizeNida(raw));
}
