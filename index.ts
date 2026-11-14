#!/usr/bin/env bun
/* ============================================================
 * deck: HTML slide decks that build to one self-contained file,
 * with a live follow-along for the audience's phones.
 *
 *     bun deck <command> [...]
 *
 * Installed in a talks folder, it is the deck bin; in a repo that
 * keeps deck/ beside its talks, bun runs this file for that folder. Each command lives in its own file and loads only when run,
 * so new, dev and publish need no npm installs.
 * ============================================================ */
import { listTalks, listThemes, talksRoot } from "./args.ts";
import { SettingsError } from "./config.ts";

const commands: Record<string, { about: string; usage: string; load: () => Promise<{ run(argv: string[]): Promise<unknown> }> }> = {
  new: { about: "start a talk", usage: 'new <talk> --title "..." [--theme name] [--speaker "Name"]', load: () => import("./new.ts") },
  dev: { about: "write and rehearse it: live reload, lint badges", usage: "dev [talk] [--port 4000] [--no-open]", load: () => import("./dev.ts") },
  check: {
    about: "every slide in both themes, the outline, share images; builds dist/",
    usage: "check [talk] [--outline] [--mode dark|light|both]",
    load: () => import("./check.ts"),
  },
  theme: {
    about: "start a theme of your own, from one that exists",
    usage: "theme <name> [--from paper]",
    load: () => import("./theme.ts"),
  },
  qr: { about: "a QR code: the talk's follow-along URL, or any URL", usage: "qr [talk | url] [--out file.svg]", load: () => import("./qr.ts") },
  publish: { about: "every talk as one static site", usage: "publish [--out site] [--base https://example.com]", load: () => import("./publish.ts") },
  serve: { about: "publish, then host it for the phones in the room (Go)", usage: "serve [--addr :8080] [--base URL] [--ip-header X-Real-IP]", load: () => import("./serve.ts") },
};

const help = () => {
  let talks: string[] = [];
  try {
    talks = listTalks(talksRoot());
  } catch {}
  const w = Math.max(...Object.values(commands).map((c) => c.usage.length));
  console.log("usage: bun deck <command>\n");
  for (const c of Object.values(commands)) console.log(`  ${c.usage.padEnd(w)}   ${c.about}`);
  console.log("\nA talk is a folder with deck/slides.html; <talk> is that folder, and can be left out when there is only one.");
  console.log(`talks:  ${talks.length ? talks.join(", ") : "none yet"}`);
  console.log(`themes: ${listThemes().join(", ")} (new --theme)`);
  console.log("settings: none needed; deck.config.json when you host (see deck's REFERENCE.md)");
};

const [name, ...argv] = process.argv.slice(2);
if (!name || name === "help" || name === "--help" || name === "-h") {
  help();
} else if (!commands[name]) {
  // The nearest command by edit distance, for a typo.
  const dist = (a: string, b: string): number => {
    const d = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0]++;
      for (let j = 1; j <= b.length; j++) {
        const cur = d[j];
        d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
      }
    }
    return d[b.length];
  };
  const near = Object.keys(commands).sort((a, b) => dist(name, a) - dist(name, b))[0];
  console.error(`deck: no command "${name}"${dist(name, near) <= 2 ? `; did you mean ${near}?` : ""}\n`);
  help();
  process.exitCode = 1;
} else {
  try {
    await (await commands[name].load()).run(argv);
  } catch (err) {
    // A settings problem is the user's to fix: say it plainly.
    if (!(err instanceof SettingsError)) throw err;
    console.error(`deck: ${err.message}`);
    process.exitCode = 1;
  }
}

export {};
