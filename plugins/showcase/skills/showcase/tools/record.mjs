// A video of the real app: a take recipe runs in a tab of its own in the project's headless
// Chrome (dev.mjs up), every frame is a full-resolution screenshot on a frame clock
// (lib/clock.mjs), and Chrome's own WebCodecs encodes them. No screen recording, no ffmpeg.
//
//   node record.mjs <take.cjs> [--out dir] [--kit name] [--fps 30] [--keep-frames]
//
// A take recipe: module.exports = (c) => ({ setup: [...steps], take: [...steps] })
//   setup  runs in real time, off camera: sign in, mocks, pre-fill a draft, `size`, `go`.
//   take   is filmed. It takes the usual steps (eval, wait, nav, go, mock, file, geo, ...;
//          `sleep` is a hold) plus:
//     tap <js> [label]            glide the pointer to the element, press, release
//     type <js> <text> [msPerChar]   tap the field, then type the text one character at a time
//     scroll <js|px> [ms]         ease the element to the upper part of the screen (or scroll
//                                 by px) in its own scroll container
//     hold <ms>                   let the screen sit
//     intro <headline> [kicker] [ms]   an opening title over the first screen (default 2500)
//     beat <headline> [kicker]    a caption from here until the next beat
//     outro <headline> [kicker] [ms]   a closing title (default 2500)
//     zoom on [scale] [js] | zoom off   a zoom from here to "zoom off" (default scale 1.3),
//                                 centred on the element, else on the taps inside it
//   <js> is a finder expression that returns an element (c.text(...), c.button(...), c.q(css)).
//
// Writes <out>/<name>.webm, <name>.webm.cursor.json (the pointer, which OpenScreen draws) and
// <name>.plan.json (captions and zooms in video seconds). reference/video.md takes it from there.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { connect, sleep } from "./lib/cdp.mjs";
import { startClock } from "./lib/clock.mjs";
import { encodeFrames } from "./lib/encode.mjs";
import { buildPlan, cursorSidecar } from "./lib/plan.mjs";
import { flag, loadProject, today } from "./lib/project.mjs";
import { loadTake } from "./lib/recipe.mjs";
import { createSteps, mountedJs, navJs, runAll } from "./lib/steps.mjs";

const file = process.argv[2];
if (!file || file.startsWith("--")) {
    console.error("usage: node record.mjs <take.cjs> [--out dir] [--kit name] [--fps 30] [--keep-frames]");
    process.exit(2);
}
const project = loadProject();
const { root, config } = project;
const { setup, take } = await loadTake(resolve(file), project);
process.chdir(root);

const name = basename(file).replace(/\.(take\.)?c?js$/i, "");
const out = resolve(flag("--out") ?? `${config.out}/${today()}`);
const fps = Number(flag("--fps") ?? 30);
const framesDir = resolve(config.work, "video", name, "frames");
const keepFrames = process.argv.includes("--keep-frames");
const video = config.video ?? {};

// Element helpers, sent with every call (a navigation wipes anything stored in the page).
const H = `const __find = (e) => { if (!e) throw new Error("not found"); return e; };
const __scroller = (e) => { for (let p = e && e.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
  const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1) return p; } return document.scrollingElement; };`;
const centre = (js) => `(() => { ${H} const e = __find(${js}); const r = e.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height, vh: innerHeight }; })()`;

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

// The take gets a tab of its own: virtual time never leaves a tab once started.
const target = await (await fetch(`http://localhost:${config.cdpPort}/json/new?about:blank`, { method: "PUT" })).json().catch(() => {
    throw new Error(`no Chrome answers on :${config.cdpPort}: run \`node dev.mjs up\` first`);
});
const page = await connect(target.webSocketDebuggerUrl);
const { send, evaluate } = page;
const runner = createSteps(page, config);
runner.state.size = { width: 390, height: 844, dpr: null }; // a phone unless setup says otherwise

let ok = false;
try {
    await runner.init();
    if (!(await runAll(setup, runner.run, "setup step"))) throw new Error("setup failed");

    const { width, height } = runner.state.size;
    const dpr = runner.dpr();
    const W = Math.round(width * dpr);
    const Hh = Math.round(height * dpr);
    if (W % 2 || Hh % 2) throw new Error(`the video would be ${W}×${Hh}: pick a size whose pixels are even on both sides`);

    await send("Page.bringToFront");
    // A tap on an upload button must not open a native file dialog: `file` fills the input.
    await send("Page.setInterceptFileChooserDialog", { enabled: true });
    await send("Emulation.setScrollbarsHidden", { hidden: true });
    await evaluate(`(() => { const s = document.createElement("style"); s.textContent = "html, * { scroll-behavior: auto !important }"; document.head.appendChild(s); })()`);
    rmSync(framesDir, { recursive: true, force: true });
    const clock = await startClock(page, { fps, dir: framesDir, viewport: { width, height } });
    const marks = [];
    const at = () => clock.now();
    const p = clock.pointer;

    async function scrollTo(js, ms = 900) {
        const r = await evaluate(centre(js));
        const goal = r.vh * 0.42;
        const delta = r.y - goal;
        if (Math.abs(delta) < 4) return;
        await tween(delta, ms, `(() => { ${H} return __scroller(${js}); })()`);
    }
    async function tween(delta, ms, scrollerJs) {
        await evaluate(`(() => { window.__showcaseScroller = ${scrollerJs}; window.__showcaseFrom = window.__showcaseScroller.scrollTop; })()`);
        const n = Math.max(2, Math.round(ms / clock.step));
        for (let i = 1; i <= n; i++) {
            await evaluate(`window.__showcaseScroller.scrollTop = window.__showcaseFrom + ${delta * ease(i / n)}`);
            await clock.frame();
        }
    }
    async function glide(x, y, ms = 520) {
        if (!p.visible) {
            // First appearance: a little below and to the right, like a thumb coming in.
            p.x = Math.min(width - 8, x + 40);
            p.y = Math.min(height - 8, y + 90);
            p.visible = true;
        }
        const fx = p.x;
        const fy = p.y;
        const n = Math.max(2, Math.round(ms / clock.step));
        for (let i = 1; i <= n; i++) {
            const k = ease(i / n);
            p.x = fx + (x - fx) * k;
            p.y = fy + (y - fy) * k;
            await clock.frame();
        }
    }
    async function tap(js, label) {
        let r = await evaluate(centre(js));
        if (r.y < r.vh * 0.18 || r.y > r.vh * 0.72) {
            await scrollTo(js);
            r = await evaluate(centre(js));
        }
        await glide(r.x, r.y);
        await clock.hold(120);
        marks.push({ kind: "tap", t: at(), cx: r.x / width, cy: r.y / height, label: label ?? "" });
        clock.mark("click");
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", buttons: 1, clickCount: 1 });
        await clock.frame();
        await clock.frame();
        clock.mark("mouseup");
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", buttons: 0, clickCount: 1 });
        await clock.hold(350);
    }
    async function type(js, text, perChar = 70) {
        await tap(js, "type");
        for (let i = 1; i <= text.length; i++) {
            // A number field wipes "5." on its way to "5.29": skip prefixes that are not numbers.
            await evaluate(`(() => { ${H} const e = __find(${js}); const v = ${JSON.stringify(text.slice(0, i))};
              if (e.type === "number" && !/^-?\\d+(\\.\\d+)?$/.test(v)) return;
              const proto = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              Object.getOwnPropertyDescriptor(proto, "value").set.call(e, ${JSON.stringify(text.slice(0, i))});
              e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
            await clock.hold(perChar);
        }
        await evaluate(`(() => { ${H} __find(${js}).dispatchEvent(new Event("change", { bubbles: true })); })()`);
        await clock.hold(300);
    }

    async function run(cmd, a) {
        switch (cmd) {
            case "tap":
                return tap(a[0], a[1]);
            case "type":
                return type(a[0], String(a[1]), a[2] ? Number(a[2]) : 70);
            case "scroll":
                if (/^-?\d+(\.\d+)?$/.test(a[0])) return tween(Number(a[0]), Number(a[1] ?? 900), "document.scrollingElement");
                return scrollTo(a[0], Number(a[1] ?? 900));
            case "hold":
            case "sleep":
                return clock.hold(Number(a[0]));
            case "intro":
            case "outro": {
                const ms = Number(a[2] || 2500);
                marks.push({ kind: cmd, t: at(), end: at() + ms / 1000, headline: a[0], kicker: a[1] || "" });
                return clock.hold(ms);
            }
            case "beat":
                return marks.push({ kind: "beat", t: at(), headline: a[0], kicker: a[1] || "" });
            case "zoom": {
                if (a[0] === "off") return marks.push({ kind: "zoom-off", t: at() });
                if (a[0] !== "on") throw new Error('zoom takes "on" or "off"');
                const scale = Number(a[1] || video.zoom || 1.3);
                const m = { kind: "zoom-on", t: at(), scale };
                if (a[2]) {
                    const r = await evaluate(centre(a[2]));
                    m.focus = { cx: r.x / width, cy: r.y / height };
                }
                return marks.push(m);
            }
            case "wait": {
                const limit = clock.count + Math.ceil(Number(a[1] ?? 15000) / clock.step);
                while (clock.count < limit) {
                    if (await evaluate(`!!(${a[0]})`).catch(() => false)) return;
                    await clock.frame();
                }
                throw new Error("timed out waiting");
            }
            case "nav":
                await evaluate(navJs(a[0], config.mountSelector));
                return clock.hold(Number(a[1] ?? 1200));
            case "go": {
                await send("Page.navigate", { url: runner.absUrl(a[0]) });
                for (let i = 0; i < 300 && !(await evaluate(mountedJs(config.mountSelector)).catch(() => false)); i++) await clock.frame();
                return clock.hold(Number(a[1] ?? 1000));
            }
            case "size":
            case "fit":
            case "shot":
                throw new Error(`"${cmd}" cannot run inside a take: put it in setup`);
            default:
                return runner.run(cmd, a);
        }
    }

    const t0 = Date.now();
    if (!(await runAll(take, run, "take step"))) throw new Error("the take failed");
    await clock.hold(200);
    const secs = (Date.now() - t0) / 1000;
    console.log(`filmed ${clock.count} frames (${clock.now().toFixed(1)} s of video) in ${secs.toFixed(0)} s`);

    page.close();
    await fetch(`http://localhost:${config.cdpPort}/json/close/${target.id}`).catch(() => {});

    const { buffer, codec } = await encodeFrames({ port: config.cdpPort, framesDir, count: clock.count, fps, width: W, height: Hh, log: console.log });
    mkdirSync(out, { recursive: true });
    const webmFile = join(out, `${name}.webm`);
    writeFileSync(webmFile, buffer);
    writeFileSync(`${webmFile}.cursor.json`, JSON.stringify(cursorSidecar(clock.samples)));
    const plan = buildPlan({ video: webmFile, width: W, height: Hh, fps, frames: clock.count, viewport: { width, height, dpr }, marks });
    writeFileSync(join(out, `${name}.plan.json`), JSON.stringify(plan, null, 2));
    console.log(`saved ${webmFile} (${W}×${Hh}, ${codec}, ${(buffer.length / 1048576).toFixed(1)} MB)`);
    console.log(`saved ${webmFile}.cursor.json and ${name}.plan.json: ${plan.captions.length} captions, ${plan.zooms.length} zooms, ${plan.taps.length} taps`);
    ok = true;
} catch (e) {
    console.error(e.message);
} finally {
    if (runner.errors.length) console.log("page errors:", JSON.stringify(runner.errors));
    page.close();
    await fetch(`http://localhost:${config.cdpPort}/json/close/${target.id}`).catch(() => {});
    if (!keepFrames) rmSync(resolve(config.work, "video", name), { recursive: true, force: true });
}
await sleep(50);
process.exit(ok ? 0 : 1);
