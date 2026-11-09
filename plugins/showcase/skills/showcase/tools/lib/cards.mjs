// Card and slide pages: crops of real screenshots on a quiet card with one label, one
// sentence and one line of context. Pure functions (no browser), so they are testable.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { pngSize } from "../set-dpi.cjs";

export const FORMATS = ["email", "slide"];

/** The default look: the changelog-card register of Linear's and Vercel's changelog images. */
export const THEME = {
    ground: "#F2F1EC",
    ink: "#14140F",
    muted: "#6B6A63",
    sub: "#5F5E57",
    accent: "#C6F24E",
    font: "Inter",
    fontUrl: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
};

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * crop(file, [x, y, w, h], scale, opts) → a div showing that rectangle of a raw screenshot.
 * The rectangle is in the raw's CSS px: desktop shots are 1440 wide by default; pass `vw`
 * for others (390 for phone shots). The height is read from the PNG.
 * opts: left|top|right|bottom (px in the stage), lift (deeper shadow, for an inset on top),
 * radius, flow (no frame, normal flow: for your own flex/grid markup), cls, vw.
 */
export const cropper = (rawDir) => (src, [x, y, w, h], scale, o = {}) => {
    const file = resolve(rawDir, src);
    const [pw, ph] = pngSize(file);
    const vw = o.vw ?? 1440;
    const vh = (ph * vw) / pw; // the raw's height in CSS px, whatever its DPR
    const pos = o.flow ? "" : ["left", "top", "right", "bottom"].filter((k) => o[k] !== undefined).map((k) => `${k}:${o[k]}px;`).join("");
    const style = [
        `width:${(w * scale).toFixed(2)}px`,
        `height:${(h * scale).toFixed(2)}px`,
        `background-image:url('${pathToFileURL(file).href}')`,
        `background-size:${(vw * scale).toFixed(2)}px ${(vh * scale).toFixed(2)}px`,
        `background-position:${(-x * scale).toFixed(2)}px ${(-y * scale).toFixed(2)}px`,
        o.radius !== undefined ? `border-radius:${o.radius}` : "",
    ]
        .filter(Boolean)
        .join(";");
    const cls = [o.flow ? "piece" : "shot", o.lift ? "lift" : "", o.cls ?? ""].filter(Boolean).join(" ");
    return `<div class="${cls}" style="${pos}${style}"></div>`;
};

const baseCss = (t) => `
  * { box-sizing: border-box; margin: 0; }
  html, body { background: ${t.ground}; }
  body { font-family: ${t.font}, system-ui, sans-serif; -webkit-font-smoothing: antialiased; color: ${t.ink}; }
  .eyebrow { font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: ${t.muted}; display: flex; align-items: center; gap: 8px; }
  .eyebrow i { border-radius: 2px; background: ${t.accent}; display: inline-block; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
  h1 { font-weight: 600; letter-spacing: -.015em; }
  p.sub { color: ${t.sub}; }
  .stage { position: relative; }
  .shot { position: absolute; background-repeat: no-repeat; border-radius: 10px; overflow: hidden;
          box-shadow: 0 0 0 1px rgba(20,20,15,.08), 0 1px 2px rgba(20,20,15,.06), 0 10px 28px -8px rgba(20,20,15,.18); }
  .shot.lift { box-shadow: 0 0 0 1px rgba(20,20,15,.10), 0 2px 4px rgba(20,20,15,.08), 0 22px 44px -12px rgba(20,20,15,.32); }
  .piece { background-repeat: no-repeat; flex: none; }
  .window { border-radius: 10px; overflow: hidden; background: #fff;
            box-shadow: 0 0 0 1px rgba(20,20,15,.08), 0 1px 2px rgba(20,20,15,.06), 0 14px 34px -10px rgba(20,20,15,.22); }
`;

const FORMAT_CSS = {
    email: `
  .card { width: 720px; padding: 30px 32px 34px; }
  .eyebrow { font-size: 11px; } .eyebrow i { width: 7px; height: 7px; }
  h1 { font-size: 21px; line-height: 1.25; margin-top: 8px; }
  p.sub { font-size: 13px; line-height: 1.45; margin-top: 5px; max-width: 600px; }
  .stage { margin-top: 22px; }`,
    slide: `
  .card { width: 1280px; height: 720px; padding: 56px 64px; overflow: hidden; position: relative; }
  .eyebrow { font-size: 13px; } .eyebrow i { width: 9px; height: 9px; }
  h1 { font-size: 36px; line-height: 1.15; margin-top: 12px; }
  p.sub { font-size: 17px; line-height: 1.5; margin-top: 10px; max-width: 820px; }
  .card.top .stage { position: absolute; left: 64px; right: 64px; top: var(--stage-top, 236px); bottom: 48px; }
  .card.side .text { position: absolute; left: 64px; top: 0; bottom: 0; width: 360px; display: flex; flex-direction: column; justify-content: center; }
  .card.side .stage { position: absolute; left: 472px; right: 56px; top: 48px; bottom: 48px; }`,
};

/** The full HTML page for one card. */
export function cardPage(card, { format = "email", lang = "en", css = "", theme = {} } = {}) {
    if (!FORMATS.includes(format)) throw new Error(`format must be ${FORMATS.join(" or ")}, not ${format}`);
    for (const k of ["name", "title", "stage"]) if (!card[k]) throw new Error(`card ${card.name ?? "?"} has no ${k}`);
    const t = { ...THEME, ...theme };
    const font = t.fontUrl ? `<link href="${esc(t.fontUrl)}" rel="stylesheet">` : "";
    const stageStyle = `${card.height ? `height:${card.height}px;` : ""}${card.stageTop ? `--stage-top:${card.stageTop}px;` : ""}`;
    return `<!doctype html>
<html lang="${esc(lang)}"><head><meta charset="utf-8"><title>${esc(card.name)}</title>
${font}
<style>${baseCss(t)}${FORMAT_CSS[format]}${css}</style></head>
<body><section class="card ${format === "slide" ? card.layout ?? "top" : ""}">
  <div class="text">
    ${card.eyebrow ? `<div class="eyebrow"><i></i>${esc(card.eyebrow)}</div>` : ""}
    <h1>${esc(card.title)}</h1>
    ${card.sub ? `<p class="sub">${esc(card.sub)}</p>` : ""}
  </div>
  <div class="stage" style="${stageStyle}">${card.stage}</div>
</section></body></html>`;
}

/** The shoot steps that render each card page to its PNG. */
export const cardSteps = (format, items) => [
    ["scrollbars", "off"],
    ...items.flatMap(({ html, png }) => [
        format === "email" ? ["size", "720", "300"] : ["size", "1280", "720"],
        ["go", pathToFileURL(html).href, 2500],
        ...(format === "email" ? [["fit"]] : []),
        ["shot", png],
    ]),
];
