// Unit tests for the showcase tools: no browser, no servers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { crc32 } from "node:zlib";

const TOOLS = resolve(import.meta.dirname, "../../plugins/showcase/skills/showcase/tools");
const require = createRequire(import.meta.url);
const { findRoot, loadProject, pickKit, today } = await import(`file://${TOOLS}/lib/project.mjs`);
const { loadSteps, listSections } = await import(`file://${TOOLS}/lib/recipe.mjs`);
const { cardPage, cardSteps, cropper, esc } = await import(`file://${TOOLS}/lib/cards.mjs`);
const { usesProfile, isRealProfile } = await import(`file://${TOOLS}/lib/chrome.mjs`);
const finders = require(`${TOOLS}/finders.cjs`);
const { setDpi, pngSize } = require(`${TOOLS}/set-dpi.cjs`);

function project(config, files = {}) {
    const root = mkdtempSync(join(tmpdir(), "showcase-unit-"));
    mkdirSync(join(root, ".showcase"), { recursive: true });
    writeFileSync(join(root, ".showcase/config.json"), JSON.stringify(config));
    for (const [rel, body] of Object.entries(files)) {
        mkdirSync(join(root, rel, ".."), { recursive: true });
        writeFileSync(join(root, rel), body);
    }
    return root;
}

/** A valid w×h RGBA PNG (one IDAT, no pHYs). */
function png(w, h) {
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body) >>> 0);
        return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const rows = Buffer.alloc((w * 4 + 1) * h);
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(rows)),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

// ------------------------------------------------------------------------------- project

test("findRoot walks up to the folder holding .showcase/config.json", () => {
    const root = project({ cdpPort: 9450 });
    mkdirSync(join(root, "a/b"), { recursive: true });
    assert.equal(findRoot(join(root, "a/b")), root);
    rmSync(root, { recursive: true });
});

test("loadProject fills defaults and trims baseUrl", () => {
    const root = project({ cdpPort: 9450, baseUrl: "http://127.0.0.1:9000/" });
    const p = loadProject({ root, argv: [] });
    assert.equal(p.config.baseUrl, "http://127.0.0.1:9000");
    assert.equal(p.config.out, ".showcase/out");
    assert.equal(p.config.work, ".showcase/.work");
    assert.equal(p.abs("x/y"), join(root, "x/y"));
    rmSync(root, { recursive: true });
});

test("loadProject demands a cdpPort and valid JSON", () => {
    const root = project({});
    assert.throws(() => loadProject({ root, argv: [] }), /needs "cdpPort"/);
    writeFileSync(join(root, ".showcase/config.json"), "{ nope");
    assert.throws(() => loadProject({ root, argv: [] }), /not valid JSON/);
    rmSync(root, { recursive: true });
});

test("pickKit: --kit, --demo, the default, the only one, none", () => {
    const two = { work: ".w", kits: { a: { dir: "ka" }, b: { default: true } } };
    assert.equal(pickKit(two, []).name, "b");
    assert.equal(pickKit(two, []).dir, ".w/b");
    assert.equal(pickKit(two, ["--kit", "a"]).dir, "ka");
    assert.equal(pickKit(two, ["--demo", "a"]).name, "a");
    assert.throws(() => pickKit(two, ["--kit", "zz"]), /no kit "zz"/);
    assert.equal(pickKit({ work: ".w", kits: { only: {} } }, []).name, "only");
    assert.equal(pickKit({ work: ".w", kits: { a: {}, b: {} } }, []).name, null);
    assert.equal(pickKit({ work: ".w", kits: {} }, []).name, null);
});

test("today is the local date", () => {
    assert.equal(today(new Date(2026, 0, 5, 0, 30)), "2026-01-05");
});

// ------------------------------------------------------------------------------- recipes

const RECIPE = `module.exports = (c) => ({
  setup: [["size", "1440", "900"], ["cookie", ...c.session.pm]],
  sections: { a: [["shot", c.out + "/a.png"]], b: [["go", c.base + "/b"]], c: [["eval", c.clickText("x")], ["eval", c.mine()]] },
});`;

test("loadSteps: setup then sections, --only, the context", async () => {
    const root = project(
        { cdpPort: 9450, baseUrl: "http://h", finders: ".showcase/finders.cjs", kits: { k: { default: true, dir: "kit" } } },
        {
            ".showcase/r.cjs": RECIPE,
            ".showcase/finders.cjs": "module.exports = { mine: () => '1+1' };",
            "kit/session.json": JSON.stringify({ pm: ["sid", "v"] }),
        },
    );
    const p = loadProject({ root, argv: [] });
    const file = join(root, ".showcase/r.cjs");
    const all = await loadSteps(file, p, ["--out", "o"]);
    assert.deepEqual(all.slice(0, 3), [["size", "1440", "900"], ["cookie", "sid", "v"], ["shot", "o/a.png"]]);
    assert.equal(all.length, 6);
    assert.deepEqual(all.at(-1), ["eval", "1+1"]); // the project's own finder
    const only = await loadSteps(file, p, ["--only", "b"]);
    assert.deepEqual(only.at(-1), ["go", "http://h/b"]);
    assert.equal(only.length, 3);
    await assert.rejects(loadSteps(file, p, ["--only", "nope"]), /no such section: nope \(have: a, b, c\)/);
    rmSync(root, { recursive: true });
});

test("loadSteps explains a missing kit; --list does not need it", async () => {
    const root = project({ cdpPort: 9450, kits: { k: { default: true, dir: "kit", setup: "bash plant.sh" } } }, { ".showcase/r.cjs": RECIPE });
    const p = loadProject({ root, argv: [] });
    await assert.rejects(loadSteps(join(root, ".showcase/r.cjs"), p, []), /plant the "k" kit first \(bash plant.sh\)/);
    rmSync(join(root, ".showcase/finders.cjs"), { force: true });
    rmSync(root, { recursive: true });
});

test("listSections works before the kit exists", async () => {
    const root = project({ cdpPort: 9450, kits: { k: { default: true, dir: "kit" } } }, { ".showcase/r.cjs": RECIPE.replace(", c.mine()", ", '0'").replace('["eval", c.mine()]', '["eval", "0"]') });
    const p = loadProject({ root, argv: [] });
    assert.deepEqual(await listSections(join(root, ".showcase/r.cjs"), p, []), ["a", "b", "c"]);
    rmSync(root, { recursive: true });
});

test("loadSteps rejects a malformed step", async () => {
    const root = project({ cdpPort: 9450 }, { ".showcase/r.cjs": "module.exports = () => ({ setup: [['size']], sections: { a: ['shot x.png'] } });" });
    await assert.rejects(loadSteps(join(root, ".showcase/r.cjs"), loadProject({ root, argv: [] }), []), /step 2 is not \[cmd, \.\.\.args\]/);
    rmSync(root, { recursive: true });
});

// ------------------------------------------------------------------------------- finders

test("every finder returns JavaScript that parses", () => {
    const exprs = [
        finders.text("a 'quoted' \"text\""),
        finders.textHas("x", "document.querySelector('dialog')"),
        finders.button("Save"),
        finders.buttonHas("sav"),
        finders.clickText("Ok"),
        finders.clickButton("Ok"),
        finders.clickButtonHas("O"),
        finders.clickSelector("#a > b"),
        finders.scrollToText("Section 2", 84),
        finders.typeInto("input[name=q]", "x'y", true),
        finders.submit("input[type=password]"),
        finders.hide(".toolbar"),
    ];
    for (const e of exprs) assert.doesNotThrow(() => new Function(`return ${e}`), e);
});

// ------------------------------------------------------------------------------- cards

test("cardPage escapes copy and keeps the stage HTML", () => {
    const html = cardPage({ name: "n", eyebrow: "A&B", title: "<b>t</b>", sub: 'say "hi"', stage: "<div class=x></div>", height: 200 }, { lang: "ro" });
    assert.match(html, /<html lang="ro">/);
    assert.match(html, /A&amp;B/);
    assert.match(html, /&lt;b&gt;t&lt;\/b&gt;/);
    assert.match(html, /say &quot;hi&quot;/);
    assert.match(html, /<div class=x><\/div>/);
    assert.match(html, /height:200px/);
    assert.match(html, /background: #F2F1EC/);
});

test("cardPage: slide layouts, themes, and its checks", () => {
    const side = cardPage({ name: "n", title: "t", stage: "s", layout: "side" }, { format: "slide", theme: { ground: "#000", fontUrl: null } });
    assert.match(side, /class="card side"/);
    assert.match(side, /background: #000/);
    assert.doesNotMatch(side, /fonts\.googleapis/);
    assert.doesNotMatch(side, /class="eyebrow"/);
    assert.throws(() => cardPage({ name: "n", title: "t", stage: "s" }, { format: "poster" }), /format must be/);
    assert.throws(() => cardPage({ name: "n", stage: "s" }), /has no title/);
});

test("cardSteps: email fits its height, slides are 1280×720", () => {
    const e = cardSteps("email", [{ html: "/tmp/a.html", png: "o/a.png" }]);
    assert.deepEqual(e[0], ["scrollbars", "off"]);
    assert.deepEqual(e[1], ["size", "720", "300"]);
    assert.deepEqual(e[3], ["fit"]);
    assert.deepEqual(e.at(-1), ["shot", "o/a.png"]);
    const s = cardSteps("slide", [{ html: "/tmp/a.html", png: "o/a.png" }]);
    assert.deepEqual(s[1], ["size", "1280", "720"]);
    assert.equal(s.length, 4);
});

test("crop maps a CSS-px rectangle of a 2x and a 3x shot", () => {
    const dir = mkdtempSync(join(tmpdir(), "showcase-crop-"));
    writeFileSync(join(dir, "desk.png"), png(2880, 1800)); // 1440×900 @2x
    writeFileSync(join(dir, "phone.png"), png(1170, 2532)); // 390×844 @3x
    const crop = cropper(dir);
    const d = crop("desk.png", [100, 50, 400, 200], 0.5, { left: 10, top: 20 });
    assert.match(d, /class="shot"/);
    assert.match(d, /left:10px;top:20px;/);
    assert.match(d, /width:200\.00px;height:100\.00px/);
    assert.match(d, /background-size:720\.00px 450\.00px/);
    assert.match(d, /background-position:-50\.00px -25\.00px/);
    const p = crop("phone.png", [0, 0, 390, 300], 1, { vw: 390, flow: true, lift: true, cls: "mail" });
    assert.match(p, /class="piece lift mail"/);
    assert.match(p, /background-size:390\.00px 844\.00px/);
    assert.doesNotMatch(p, /left:/);
    rmSync(dir, { recursive: true });
});

test("esc covers the HTML specials", () => {
    assert.equal(esc(`<a href="x">&</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
    assert.equal(esc(undefined), "");
});

// ------------------------------------------------------------------------------- set-dpi

test("setDpi writes one pHYs chunk after IHDR and keeps the image", () => {
    const dir = mkdtempSync(join(tmpdir(), "showcase-dpi-"));
    const f = join(dir, "a.png");
    writeFileSync(f, png(40, 30));
    setDpi(f);
    setDpi(f, 144); // a second run replaces, never duplicates
    const buf = readFileSync(f);
    assert.equal(buf.toString("latin1").split("pHYs").length - 1, 1);
    assert.equal(buf.toString("latin1", 37, 41), "pHYs"); // right after IHDR (8 + 25 + 4)
    assert.equal(Math.round(buf.readUInt32BE(41) * 0.0254), 144);
    assert.deepEqual(pngSize(f), [40, 30]);
    rmSync(dir, { recursive: true });
});

// ------------------------------------------------------------------------------- chrome

test("usesProfile matches exactly this profile, any slash or case", () => {
    const profile = "D:\\Code\\app\\.showcase\\.work\\chrome-profile";
    assert.ok(usesProfile(`"C:\\chrome.exe" --headless=new --user-data-dir=D:\\Code\\app\\.showcase\\.work\\chrome-profile about:blank`, profile));
    assert.ok(usesProfile(`chrome --user-data-dir="d:/code/app/.showcase/.work/chrome-profile"`, profile));
    assert.ok(!usesProfile(`chrome --user-data-dir=D:\\Code\\app\\.showcase\\.work\\chrome-profile-2`, profile));
    assert.ok(!usesProfile(`chrome --user-data-dir=D:\\Code\\other\\.showcase\\.work\\chrome-profile`, profile));
    assert.ok(!usesProfile("", profile));
});

test("isRealProfile spots the user's everyday browser", () => {
    assert.ok(isRealProfile(`"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data"`));
    assert.ok(isRealProfile(`"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9444`));
    assert.ok(isRealProfile("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/me/Library/Application Support/Google/Chrome"));
    assert.ok(!isRealProfile(`chrome --user-data-dir=D:\\Code\\app\\.showcase\\.work\\chrome-profile`));
    assert.ok(!isRealProfile("node server.mjs"));
});
