// Admin TOTP enrollment for Google Authenticator / Authy / 1Password.
//
//   node dev/totp-enroll.mjs                → new base32 secret + otpauth:// URI
//   node dev/totp-enroll.mjs --code SECRET  → current 6-digit code (for testing)
//
// The secret is a server-side credential: set it as ADMIN_TOTP_SECRET on the
// edge function. Never commit it.
import { randomBytes } from "node:crypto";
import { base32Encode, generateTotp } from "../supabase/functions/app/lib/totp.mjs";

if (process.argv[2] === "--code") {
  const code = await generateTotp(process.argv[3] ?? "");
  console.log(code ?? "error: secret is not valid base32");
} else {
  const secret = base32Encode(randomBytes(20));
  const uri = `otpauth://totp/${encodeURIComponent("Prime Games:admin")}?secret=${secret}&issuer=${encodeURIComponent("Prime Games")}&algorithm=SHA1&digits=6&period=30`;
  console.log("ADMIN_TOTP_SECRET (base32, 160-bit):");
  console.log(`  ${secret}`);
  console.log("");
  console.log("Add to Google Authenticator / Authy / 1Password:");
  console.log(`  ${uri}`);
  console.log("");
  console.log("Set it on the deployed edge function (never in the repo):");
  console.log(`  supabase secrets set ADMIN_TOTP_SECRET=${secret}`);
  console.log("");
  console.log("For the local harness:");
  console.log(`  ADMIN_TOTP_SECRET=${secret} node dev/edge-server.mjs`);
  console.log("");
  console.log(`Current code right now: ${await generateTotp(secret)} (valid ~30s)`);
  console.log("Store the secret in your password manager: losing it locks out recovery.");
}