// Host-aware wiring for the public site. On Qoder Sites the portal lives at
// /app/ and the API is same-origin; on Vercel the portal lives at /portal/
// and the API is the Supabase Edge Function (cross-origin, CORS-allowlisted).
// Any other host keeps the Qoder defaults, so existing hosting is unchanged.
(function () {
  "use strict";
  var onVercel = /\.vercel\.app$/.test(location.hostname);
  window.PG_PORTAL_BASE = onVercel ? "/portal/" : "/app/index.html";
  if (onVercel) {
    window.PG_API_BASE = "https://poaxanthiifatydqbnqq.supabase.co/functions/v1/app";
  }
  document.addEventListener("DOMContentLoaded", function () {
    var targets = {
      account: window.PG_PORTAL_BASE,
      admin: onVercel ? "/admin/login" : "/app/index.html#/admin",
    };
    document.querySelectorAll("[data-pg-link]").forEach(function (a) {
      var href = targets[a.getAttribute("data-pg-link")];
      if (href) a.setAttribute("href", href);
    });
  });
})();