// Compose raw screenshots into finished cards, rendered by the project's Chrome at 2x and
// tagged 192 dpi.
//
//   node compose.mjs <cards.cjs> [--only name,name] [--out dir]
//
// Formats (the spec's `format`):
//   email  720 css wide, height fits the content: pasted into an email BODY (Outlook and Word
//          show a 1440 px card at 720 px thanks to 192 dpi; Gmail fits it to the column).
//   slide  1280×720 css (16:9): a presentation slide, `layout` 'top' (text above the stage)
//          or 'side' (text in a left column). 2560 px at 192 dpi = a 13.33" widescreen slide.
//
// A spec is a CommonJS module:
//   { format, raw, out?, lang?, css?, theme?, cards: ({ crop }) => [...] }
//   raw    folder of the raw shots the cards crop (relative to the project root)
//   out    default output folder (--out wins; else <config.out>/<today>)
//   theme  { ground, ink, muted, sub, accent, font, fontUrl } over the default look
//   card   { name, eyebrow?, title, sub?, stage, height? (email stage px),
//            layout? 'top'|'side' and stageTop? (slides) }
//   crop   see lib/cards.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cardPage, cardSteps, cropper } from "./lib/cards.mjs";
import { flag, loadProject, today } from "./lib/project.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { setDpi, pngSize } = require("./set-dpi.cjs");

if (!process.argv[2] || process.argv[2].startsWith("--")) {
    console.error("usage: node compose.mjs <cards.cjs> [--only name,name] [--out dir]");
    process.exit(2);
}
const specFile = resolve(process.argv[2]);
const { root, config, abs } = loadProject();
const spec = require(specFile);

const format = spec.format ?? "email";
const out = flag("--out") ?? spec.out ?? `${config.out}/${today()}`;
const only = flag("--only")?.split(",");
const all = spec.cards({ crop: cropper(abs(spec.raw ?? ".")) });
const built = all.filter((c) => !only || only.includes(c.name));
if (!built.length) throw new Error(`no cards selected (have: ${all.map((c) => c.name).join(", ")})`);

const work = join(abs(config.work), "compose");
mkdirSync(work, { recursive: true });
mkdirSync(abs(out), { recursive: true });
const items = built.map((card) => {
    const html = join(work, `${card.name}.html`);
    writeFileSync(html, cardPage(card, { format, lang: spec.lang ?? config.lang, css: spec.css, theme: spec.theme }));
    return { html, png: `${out}/${card.name}.png` };
});
const steps = join(work, "steps.json");
writeFileSync(steps, JSON.stringify(cardSteps(format, items)));
const run = spawnSync(process.execPath, [join(here, "shoot.mjs"), steps, "--root", root], { stdio: "inherit" });
if (run.status !== 0) process.exit(run.status ?? 1);
for (const { png } of items) {
    const f = abs(png);
    setDpi(f);
    const [w, h] = pngSize(f);
    console.log(`card ${png}  ${w}×${h} px, 192 dpi → ${w / 2}×${h / 2} on the page`);
}
