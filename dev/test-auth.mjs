// Local-only ES256 test identity: keypair, JWKS and JWT minting for the Phase 4
// harness and test suite. Never deployed; never touches the real Supabase auth.
let issuer = "http://127.0.0.1:4175";
let keyPair = null;
let publicJwk = null;

export const setTestIssuer = (origin) => { issuer = origin; };
export const testIssuer = () => issuer;
export const testJwksUrl = () => `${issuer}/auth/v1/.well-known/jwks.json`;

export async function testKeys() {
  if (!keyPair) {
    keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    publicJwk = { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, kid: "test-key-1", alg: "ES256", use: "sig" };
  }
  return { keyPair, publicJwk };
}

export async function testJwksResponse() {
  const { publicJwk: jwk } = await testKeys();
  return Response.json({ keys: [jwk] });
}

const b64url = (input) => Buffer.from(input).toString("base64url");

// Mint a customer JWT. Pass exp: undefined to omit the claim, kid: undefined to
// omit the header kid, or override any claim for negative tests.
export async function mintToken(opts = {}) {
  const { sub, aud = "authenticated", iss = `${issuer}/auth/v1`, ...rest } = opts;
  const exp = Object.hasOwn(opts, "exp") ? opts.exp : Math.floor(Date.now() / 1000) + 3600;
  const kid = Object.hasOwn(opts, "kid") ? opts.kid : "test-key-1";
  delete rest.exp; delete rest.kid;
  const { keyPair: keys } = await testKeys();
  const header = { alg: "ES256", typ: "JWT", ...(kid !== undefined ? { kid } : {}) };
  const payload = { sub, aud, iss, iat: Math.floor(Date.now() / 1000), ...(exp !== undefined ? { exp } : {}), ...rest };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}