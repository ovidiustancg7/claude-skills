// End to end against the fixture app: dev up → shoot (mock, rewrite, cookie, nav, wait,
// full page, phone) → login through a form → record a video take → compose (email and
// slide) → dev down.
// Needs Chrome (or Edge) and the ports 8765 (fixture) and 9450 (CDP) free.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "fixture-app");
const TOOLS = resolve(here, "../../plugins/showcase/skills/showcase/tools");
const { pngSize } = createRequire(import.meta.url)(join(TOOLS, "set-dpi.cjs"));
const OUT = ".showcase/out/e2e";

const tool = (name, args, env = {}) => {
    const r = spawnSync(process.execPath, [join(TOOLS, name), ...args], {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, ...env },
        timeout: 180000,
    });
    const output = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, `${name} ${args.join(" ")} failed:\n${output}`);
    return output;
};
const dpiOf = (file) => {
    const png = readFileSync(file);
    const at = png.indexOf("pHYs");
    return at < 0 ? null : Math.round(png.readUInt32BE(at + 4) * 0.0254);
};
const answers = async (url) => {
    try {
        await fetch(url, { signal: AbortSignal.timeout(1500) });
        return true;
    } catch {
        return false;
    }
};

before(() => {
    rmSync(join(ROOT, ".showcase/out"), { recursive: true, force: true });
    // The kit, as a project's setup script would plant it.
    const kit = join(ROOT, ".showcase/.work/demo");
    mkdirSync(join(kit, "mocks"), { recursive: true });
    writeFileSync(join(kit, "ids.json"), JSON.stringify({ admin: 1 }));
    writeFileSync(join(kit, "session.json"), JSON.stringify({ admin: ["sid", "demo"] }));
    writeFileSync(join(kit, "mocks/external.json"), JSON.stringify({ label: "ERP: 3 stores synced" }));
});

after(async () => {
    tool("dev.mjs", ["down"]);
    assert.equal(await answers("http://localhost:9450/json/version"), false, "chrome still answers after down");
    assert.equal(await answers("http://127.0.0.1:8765/login"), false, "fixture app still answers after down");
    rmSync(join(ROOT, ".showcase/out"), { recursive: true, force: true });
    rmSync(join(ROOT, ".showcase/.work"), { recursive: true, force: true });
});

test("dev up starts the app and the project's Chrome", () => {
    const out = tool("dev.mjs", ["up"]);
    assert.match(out, /ready: fixture, chrome :9450/);
    assert.match(tool("dev.mjs", ["status"]), /chrome :9450: up \(this project's\)/);
});

test("--list prints the sections without a planted kit", () => {
    assert.equal(tool("shoot.mjs", [".showcase/recipes/tour.cjs", "--list", "--kit", "demo"]).trim(), "desktop\nphone");
});

test("a recipe shoots with a session, a mock, a rewrite and SPA navigation", () => {
    const out = tool("shoot.mjs", [".showcase/recipes/tour.cjs", "--out", OUT]);
    assert.match(out, /https:\/\/app\.example\.com\/share\/abc \| ERP: 3 stores synced/);
    assert.match(out, /nav \/orders \(history\)/);
    assert.deepEqual(pngSize(join(ROOT, OUT, "01-desktop-dashboard.png")), [2880, 1800]);
    const [w, h] = pngSize(join(ROOT, OUT, "02-desktop-orders-full.png"));
    assert.equal(w, 2880);
    assert.ok(h > 1800, `full-page shot should be taller than the viewport, got ${h}`);
    assert.deepEqual(pngSize(join(ROOT, OUT, "03-phone-orders.png")), [1170, 2532]);
});

test("--only runs setup plus the named section", () => {
    const out = tool("shoot.mjs", [".showcase/recipes/tour.cjs", "--only", "phone", "--out", `${OUT}-only`]);
    assert.match(out, /03-phone-orders\.png/);
    assert.doesNotMatch(out, /01-desktop-dashboard/);
});

test("a failing step stops the run and names it", () => {
    const r = spawnSync(process.execPath, [join(TOOLS, "shoot.mjs"), "steps.json"], { cwd: ROOT, encoding: "utf8", input: "" });
    assert.notEqual(r.status, 0); // no such file
    const steps = join(ROOT, ".showcase/.work/bad-steps.json");
    writeFileSync(steps, JSON.stringify([["go", "/login", 100], ["eval", "(() => { throw new Error('boom') })()"], ["shot", "never.png"]]));
    const bad = spawnSync(process.execPath, [join(TOOLS, "shoot.mjs"), steps], { cwd: ROOT, encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /step 2\/3 failed: eval/);
    assert.match(bad.stderr, /boom/);
});

test("a server-rendered login form signs in", () => {
    const out = tool("shoot.mjs", [".showcase/recipes/login.cjs"]);
    assert.match(out, /"\/"/);
});

test("record films a take: a 1170×2532 WebM, the pointer sidecar, the plan, CSS on the frame clock", async () => {
    const { readElements, ID } = await import(pathToFileURL(join(TOOLS, "lib/webm.mjs")).href);
    const out = tool("record.mjs", [".showcase/recipes/report.take.cjs", "--out", `${OUT}/video`]);
    // The panel's 1 s linear slide starts at -376 px: 26 frames (867 ms) later it is at ~-50.
    const at = Number(out.match(/panel at (-?\d+)/)[1]);
    assert.ok(Math.abs(at + 50) <= 10, `CSS transition off the frame clock: panel at ${at}, expected about -50`);
    assert.match(out, /saved .*report\.webm \(1170×2532, vp/);

    const file = join(ROOT, OUT, "video/report.webm");
    const buf = readFileSync(file);
    const [ebml, segment] = readElements(buf);
    assert.equal(ebml.id, ID.EBML);
    assert.equal(segment.dataStart + segment.size, buf.length);

    const plan = JSON.parse(readFileSync(join(ROOT, OUT, "video/report.plan.json"), "utf8"));
    assert.deepEqual([plan.width, plan.height, plan.fps], [1170, 2532, 30]);
    assert.ok(plan.duration > 10 && plan.duration < 15, `duration ${plan.duration}`);
    assert.deepEqual(plan.captions.map((c) => c.style), ["intro", "beat", "beat", "outro"]);
    assert.equal(plan.captions[1].start, 2.5, "the intro holds 2.5 s");
    assert.equal(plan.zooms.length, 1);
    assert.deepEqual(plan.taps.map((t) => t.label), ["type", "fridge yes", "send"]);
    // The zoom is centred on the field that was typed into.
    assert.deepEqual(plan.zooms[0].focus, { cx: plan.taps[0].cx, cy: plan.taps[0].cy });

    const cursor = JSON.parse(readFileSync(`${file}.cursor.json`, "utf8"));
    assert.equal(cursor.version, 2);
    assert.equal(cursor.samples.length, Math.round(plan.duration * 30));
    assert.equal(cursor.samples.filter((s) => s.interactionType === "click").length, 3);
    assert.equal(cursor.samples[0].visible, false, "no pointer before the first tap");

    assert.equal(existsSync(join(ROOT, ".showcase/.work/video/report")), false, "frames are cleaned up");
    const pages = (await (await fetch("http://localhost:9450/json")).json()).filter((t) => t.type === "page");
    assert.equal(pages.length, 1, "the take's own tab is closed");
});

test("compose makes a 1440 px email card and a 2560×1440 slide at 192 dpi", () => {
    const env = { SHOWCASE_RAW: OUT };
    tool("compose.mjs", [".showcase/recipes/tour.cards.cjs", "--out", `${OUT}/cards`], env);
    const card = join(ROOT, OUT, "cards/dashboard.png");
    const [w] = pngSize(card);
    assert.equal(w, 1440);
    assert.equal(dpiOf(card), 192);
    tool("compose.mjs", [".showcase/recipes/tour.cards.cjs", "--out", `${OUT}/slides`], { ...env, SHOWCASE_FORMAT: "slide" });
    const slide = join(ROOT, OUT, "slides/dashboard.png");
    assert.deepEqual(pngSize(slide), [2560, 1440]);
    assert.equal(dpiOf(slide), 192);
    // The title is escaped, not parsed as markup.
    assert.match(readFileSync(join(ROOT, ".showcase/.work/compose/dashboard.html"), "utf8"), /Orders &amp; shares &lt;at a glance&gt;/);
});

test("dev up refuses a port held by something else", async () => {
    // A plain HTTP server pretending to be a CDP endpoint on another project's port. In its
    // own process: spawnSync below blocks this one, so an in-process server could not answer.
    const { spawn } = await import("node:child_process");
    const squatter = spawn(process.execPath, ["-e", "require('http').createServer((_, r) => r.end('{}')).listen(9451, '127.0.0.1', () => console.log('up'))"]);
    await new Promise((r) => squatter.stdout.once("data", r));
    const cfg = join(ROOT, ".showcase/config.json");
    const original = readFileSync(cfg, "utf8");
    try {
        writeFileSync(cfg, original.replace('"cdpPort": 9450', '"cdpPort": 9451'));
        const r = spawnSync(process.execPath, [join(TOOLS, "dev.mjs"), "up", "--no-app"], { cwd: ROOT, encoding: "utf8" });
        assert.equal(r.status, 1, r.stdout + r.stderr);
        assert.match(r.stderr, /not this project's Chrome, refusing/);
        // And closing never goes to it.
        const { close } = await import(pathToFileURL(join(TOOLS, "lib/chrome.mjs")).href);
        const res = await close(9451, join(ROOT, ".showcase/.work/chrome-profile"));
        assert.equal(res.closed, false);
        assert.match(res.reason, /not this project's Chrome, left alone/);
    } finally {
        writeFileSync(cfg, original);
        squatter.kill();
    }
});
