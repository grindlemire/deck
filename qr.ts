/* ============================================================
 * deck / qr.ts
 * deck qr: a QR code as an SVG, for a slide.
 *
 *   bun deck qr my-talk          the talk's follow-along URL
 *                                   (<site><prefix>/my-talk/live, from
 *                                   deck.config.json; without a site,
 *                                   this machine on this network) into
 *                                   my-talk/deck/media/qr-follow.svg
 *   bun deck qr <url>            any URL (the slides, a repo), to stdout
 *   ... --out file.svg              either one, into that file
 *
 * Dark squares on white with a quiet border, so it scans off a
 * projector in either theme. Put it on a slide like any image:
 * <img src="media/qr-follow.svg" alt="...">. deck check rewrites
 * qr-follow.svg whenever slides.html uses it, so it follows the
 * settings, and deck serve swaps in one for the network it is on
 * (publish.ts), so a talk given from a laptop needs no site at all.
 * ============================================================ */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fail, findDeck, parseArgs, talkName } from "./args.ts";
import { readConfig } from "./config.ts";

// Medium error correction survives a glare spot on the screen. qrcode
// loads only here, so commands that never draw one need no install.
export const qrSvg = async (url: string): Promise<string> => {
  const { default: QRCode } = await import("qrcode").catch(() => fail("QR codes need the qrcode package: bun install"));
  return QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#ffffff" } });
};

/* The port deck serve listens on unless told otherwise. */
export const SERVE_PORT = process.env.PORT || "8080";

/* This machine's address on the network it is on, for the phones in
   the room: a private IPv4 address, Wi-Fi or Ethernet first (a VPN's
   comes after), else null. */
export const localAddress = (): string | null => {
  const nets = Object.entries(os.networkInterfaces()).flatMap(([name, addrs]) =>
    (addrs ?? []).filter((a) => a.family === "IPv4" && !a.internal).map((a) => ({ name, ip: a.address })),
  );
  const local = nets.filter((n) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.ip));
  const nic = local.find((n) => /^(en|eth|wl)/.test(n.name)) ?? local[0];
  return nic?.ip ?? null;
};

/* The origin deck serve is reachable at from a phone, or null. */
export const localOrigin = (port = SERVE_PORT): string | null => {
  const ip = localAddress();
  return ip && `http://${ip}:${port}`;
};

/* The follow-along URL for a deck: on origin, else the site, else null. */
export const followUrl = (deckDir: string, origin?: string): string | null => {
  const { site, prefix } = readConfig(deckDir);
  const at = origin ?? site;
  return at ? `${at}${prefix}/${talkName(deckDir)}/live` : null;
};

/* Write the deck's media/qr-follow.svg (or out); returns the URL. */
export const writeFollowQr = async (deckDir: string, out = path.join(deckDir, "media", "qr-follow.svg"), origin?: string): Promise<string | null> => {
  const url = followUrl(deckDir, origin);
  if (!url) return null;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await qrSvg(url));
  return url;
};

export async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv, ["out"]);
  const what = args.positional[0];
  const out = args.opt("out");
  if (!what) fail("usage: bun deck qr <talk | url> [--out file.svg]");

  if (/^https?:\/\//.test(what)) {
    const svg = await qrSvg(what);
    if (out) {
      fs.writeFileSync(out, svg);
      console.log(`wrote ${out} for ${what}`);
    } else process.stdout.write(svg);
    return;
  }

  const deckDir = findDeck(what);
  const file = out ?? path.join(deckDir, "media", "qr-follow.svg");
  const { site } = readConfig(deckDir);
  const origin = site ? undefined : (localOrigin() ?? fail(`no site in deck.config.json and no network here, so ${talkName(deckDir)} has no follow-along URL (or pass a URL)`));
  const url = await writeFollowQr(deckDir, file, origin);
  console.log(`wrote ${path.relative(process.cwd(), file)} for ${url}`);
  if (!site) console.log("(no site in deck.config.json, so it points at this machine; bun deck serve redraws it for whichever network you are on)");
}
