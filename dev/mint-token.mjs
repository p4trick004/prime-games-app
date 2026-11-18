// Local-only helper: mint a fixture customer JWT for the edge-server harness.
//   node dev/mint-token.mjs <auth-user-uuid> [port]
import { mintToken, setTestIssuer } from "./test-auth.mjs";

const sub = process.argv[2];
if (!sub) {
  console.error("usage: node dev/mint-token.mjs <auth-user-uuid> [port]");
  process.exit(1);
}
setTestIssuer(`http://127.0.0.1:${Number(process.argv[3] || 4175)}`);
console.log(await mintToken({ sub }));