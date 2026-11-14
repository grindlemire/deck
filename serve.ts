/* ============================================================
 * deck / serve.ts
 * deck serve: publish every talk, then host the site with the
 * live follow-along (deck/server, which needs Go).
 *
 *     bun deck serve [--out site] [--addr :8080] [--base URL]
 *                       [--ip-header X-Real-IP]
 *
 * It prints each talk's audience URL on this machine's network, so
 * phones in the room can follow without any hosting, and each deck's
 * follow-along QR (media/qr-follow.svg) points there too, for the
 * network you are on now. --base points the QRs somewhere else (the
 * origin phones reach this server on). The key that leads a talk is
 * DECK_LEAD_KEY, else one made up and printed. --ip-header only
 * behind a proxy that sets it (see REFERENCE.md). To host for real,
 * build deck/server once and run it on the site that deck
 * publish writes (deploy/ in deck has a Dockerfile).
 * ============================================================ */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fail, parseArgs } from "./args.ts";
import { publishSite } from "./publish.ts";
import { localOrigin, SERVE_PORT } from "./qr.ts";

export async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv, ["out", "base", "addr", "ip-header"]);
  if (!Bun.which("go")) fail("deck serve runs deck/server, which needs Go: https://go.dev/dl");

  // The QRs point where phones on this network reach the server: the
  // host in --addr if it names one, else this machine's address.
  const addr = args.opt("addr");
  const [, host, port] = addr?.match(/^(.*):(\d+)$/) ?? [];
  const named = host && !["0.0.0.0", "[::]", "::"].includes(host) ? `http://${host}:${port}` : null;
  const follow = args.opt("base") ?? named ?? localOrigin(port || SERVE_PORT) ?? undefined;
  if (!follow) console.warn("warning: no network address here, so the follow-along QRs keep what check drew");

  const site = await publishSite({ out: args.opt("out"), base: args.opt("base"), follow });
  if (follow) console.log(`follow-along QRs point at ${follow}`);
  const flags = ["-site", site];
  if (addr) flags.push("-addr", addr);
  if (args.opt("ip-header")) flags.push("-ip-header", args.opt("ip-header")!);

  console.log("\nstarting deck/server (go run)...\n");
  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), "server");
  const proc = Bun.spawn(["go", "run", ".", ...flags], { cwd: server, stdio: ["inherit", "inherit", "inherit"] });
  process.exitCode = await proc.exited;
}
