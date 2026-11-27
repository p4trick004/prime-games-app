// Tanzanian NIDA NIN: 20 digits, printed as XXXXXXXX-XXXXX-XXXXX-XX.
// Hyphens and spaces are optional separators; the normalized value is always
// a string so leading zeros survive.
(function (root) {
  function normalizeNida(raw) {
    return String(raw == null ? "" : raw).replace(/[\s-]/g, "");
  }
  function isValidNida(raw) {
    return /^\d{20}$/.test(normalizeNida(raw));
  }
  var api = { normalizeNida: normalizeNida, isValidNida: isValidNida };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else root.PGNida = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
