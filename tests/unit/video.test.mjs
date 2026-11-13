// Unit tests for the video mode: the WebM writer, the edit plan, the pointer sidecar and the
// page time warp (run in a vm with fake timers and animations, no browser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import vm from "node:vm";

const LIB = resolve(import.meta.dirname, "../../plugins/showcase/skills/showcase/tools/lib");
const { webm, readElements, ID } = await import(`file://${LIB}/webm.mjs`);
const { buildPlan, captions, zooms, zoomMove, cursorSidecar } = await import(`file://${LIB}/plan.mjs`);
const { TIME_WARP } = await import(`file://${LIB}/clock.mjs`);
const { loadTake } = await import(`file://${LIB}/recipe.mjs`);
const { loadProject } = await import(`file://${LIB}/project.mjs`);

const frames = (n, keyEvery = 60) =>
    Array.from({ length: n }, (_, i) => ({ data: Buffer.from([i & 0xff, 1, 2, 3]), ms: (i * 1000) / 30, key: i % keyEvery === 0 }));

test("webm: EBML header, a sized Segment, Info with the duration, one Cluster per keyframe, Cues", () => {
    const buf = webm({ width: 1170, height: 2532, fps: 30, frames: frames(150) });
    const top = readElements(buf);
    assert.deepEqual(top.map((e) => e.id), [ID.EBML, ID.Segment]);
    assert.equal(top[1].dataStart + top[1].size, buf.length, "the Segment size covers the rest of the file");
    const seg = readElements(buf, top[1].dataStart, buf.length);
    const ids = seg.map((e) => e.id);
    assert.equal(ids[0], ID.Info);
    assert.equal(ids[1], ID.Tracks);
    assert.equal(ids.filter((i) => i === ID.Cluster).length, 3, "150 frames, a keyframe every 60");
    assert.equal(ids.at(-1), ID.Cues);
    const info = readElements(buf, seg[0].dataStart, seg[0].dataStart + seg[0].size);
    const dur = info.find((e) => e.id === ID.Duration);
    assert.equal(buf.readDoubleBE(dur.dataStart), 5000, "150 frames at 30 fps = 5000 ms");
    // Every cue points at a cluster, relative to the Segment's data.
    const cues = seg.at(-1);
    const clusterOffsets = seg.filter((e) => e.id === ID.Cluster).map((e) => e.start - top[1].dataStart);
    const positions = [];
    for (const cp of readElements(buf, cues.dataStart, cues.dataStart + cues.size)) {
        const ctp = readElements(buf, cp.dataStart, cp.dataStart + cp.size).find((e) => e.id === ID.CueTrackPositions);
        const pos = readElements(buf, ctp.dataStart, ctp.dataStart + ctp.size).find((e) => e.id === ID.CueClusterPosition);
        positions.push(buf.readUIntBE(pos.dataStart, pos.size));
    }
    assert.deepEqual(positions, clusterOffsets);
});

test("webm: track carries the codec and size; blocks keep frame order and key flags", () => {
    const buf = webm({ width: 640, height: 360, fps: 30, codec: "V_VP8", frames: frames(70) });
    const [, segment] = readElements(buf);
    const seg = readElements(buf, segment.dataStart, buf.length);
    const tracks = seg[1];
    const entry = readElements(buf, tracks.dataStart, tracks.dataStart + tracks.size)[0];
    const fields = readElements(buf, entry.dataStart, entry.dataStart + entry.size);
    const codec = fields.find((e) => e.id === ID.CodecID);
    assert.equal(buf.toString("utf8", codec.dataStart, codec.dataStart + codec.size), "V_VP8");
    const video = fields.find((e) => e.id === ID.Video);
    const dims = readElements(buf, video.dataStart, video.dataStart + video.size);
    assert.equal(buf.readUIntBE(dims[0].dataStart, dims[0].size), 640);
    assert.equal(buf.readUIntBE(dims[1].dataStart, dims[1].size), 360);
    const second = seg.filter((e) => e.id === ID.Cluster)[1];
    const inside = readElements(buf, second.dataStart, second.dataStart + second.size);
    assert.equal(buf.readUIntBE(inside[0].dataStart, inside[0].size), 2000, "cluster 2 starts at frame 60 = 2000 ms");
    const blocks = inside.filter((e) => e.id === ID.SimpleBlock);
    assert.equal(blocks.length, 10);
    assert.equal(buf[blocks[0].dataStart + 3], 0x80, "first block of a cluster is a keyframe");
    assert.equal(buf[blocks[1].dataStart + 3], 0x00);
    assert.equal(buf.readInt16BE(blocks[1].dataStart + 1), 33, "relative timecode in ms");
    assert.equal(buf[blocks[1].dataStart + 4], 61, "payload is frame 61");
});

test("webm refuses an empty take or a first frame that is not a keyframe", () => {
    assert.throws(() => webm({ width: 2, height: 2, fps: 30, frames: [] }), /no frames/);
    assert.throws(() => webm({ width: 2, height: 2, fps: 30, frames: [{ data: Buffer.alloc(1), ms: 0, key: false }] }), /keyframe/);
});

test("beats run until the next caption; intro and outro only for their hold", () => {
    const marks = [
        { kind: "intro", t: 0, end: 2.5, headline: "Title", kicker: "BRAND" },
        { kind: "tap", t: 3, cx: 0.5, cy: 0.5 },
        { kind: "beat", t: 4.2, headline: "Step one", kicker: "" },
        { kind: "outro", t: 9, end: 11.5, headline: "Done", kicker: "" },
    ];
    assert.deepEqual(captions(marks, 11.7), [
        { style: "intro", start: 0, end: 2.5, headline: "Title", kicker: "BRAND" },
        { style: "beat", start: 4.2, end: 9, headline: "Step one" },
        { style: "outro", start: 9, end: 11.5, headline: "Done" },
    ]);
});

test("zooms hold between their moves, centred on the taps inside, or on a named element", () => {
    const move = zoomMove(1.3);
    assert.ok(Math.abs(move - 0.744) < 0.001);
    const marks = [
        { kind: "zoom-on", t: 2, scale: 1.3 },
        { kind: "tap", t: 2.5, cx: 0.4, cy: 0.2 },
        { kind: "tap", t: 3, cx: 0.6, cy: 0.3 },
        { kind: "tap", t: 3.5, cx: 0.5, cy: 0.9 },
        { kind: "zoom-off", t: 5 },
        { kind: "zoom-on", t: 6, scale: 1.5, focus: { cx: 0.2, cy: 0.7 } },
    ];
    const z = zooms(marks, 9);
    assert.deepEqual(z[0], { start: 2.74, end: 4.26, scale: 1.3, focus: { cx: 0.5, cy: 0.3 } });
    assert.deepEqual(z[1].focus, { cx: 0.2, cy: 0.7 }, "a named element wins; the last zoom closes at the end");
    assert.equal(z[1].end, Math.round((9 - zoomMove(1.5)) * 100) / 100);
    assert.throws(() => zooms([{ kind: "zoom-on", t: 1, scale: 1.3 }, { kind: "zoom-off", t: 2 }], 5), /too short/);
    assert.deepEqual(zooms([{ kind: "zoom-on", t: 0, scale: 1.3 }, { kind: "zoom-off", t: 4 }], 5)[0].focus, { cx: 0.5, cy: 0.5 });
});

test("buildPlan sums the take up in video seconds", () => {
    const plan = buildPlan({
        video: "x.webm",
        width: 1170,
        height: 2532,
        fps: 30,
        frames: 369,
        viewport: { width: 390, height: 844, dpr: 3 },
        marks: [{ kind: "beat", t: 0, headline: "A" }, { kind: "tap", t: 1.234, cx: 0.123, cy: 0.456, label: "go" }],
    });
    assert.equal(plan.duration, 12.3);
    assert.deepEqual(plan.taps, [{ t: 1.23, cx: 0.12, cy: 0.46, label: "go" }]);
    assert.deepEqual(plan.zooms, []);
    assert.equal(plan.captions[0].end, 12.3);
});

test("cursorSidecar is the shape OpenScreen reads next to a video", () => {
    const s = cursorSidecar([
        { timeMs: 0, cx: 0.5, cy: 0.5, visible: false },
        { timeMs: 33.33, cx: 0.123456, cy: 0.5, visible: true, type: "click" },
    ]);
    assert.equal(s.version, 2);
    assert.equal(s.provider, "native");
    assert.deepEqual(s.assets, []);
    assert.deepEqual(s.samples[1], { timeMs: 33, cx: 0.1235, cy: 0.5, visible: true, assetId: null, cursorType: null, interactionType: "click" });
    assert.equal(s.samples[0].interactionType, "move");
});

// A page stand-in: real timers and Date stay the vm's, animations are fakes with the
// Web Animations surface the warp uses.
function fakePage() {
    const anims = [];
    const page = {
        performance: { now: () => 1000 },
        Date,
        console,
        document: { getAnimations: () => anims },
    };
    page.window = page;
    vm.createContext(page);
    vm.runInContext(TIME_WARP, page);
    const anim = (endTime) => {
        const a = { currentTime: null, playState: "running", paused: false, finished: false, effect: { getComputedTiming: () => ({ endTime }) } };
        a.pause = () => (a.paused = true);
        a.finish = () => ((a.finished = true), (a.playState = "finished"));
        anims.push(a);
        return a;
    };
    return { page, anim, run: (js) => vm.runInContext(js, page) };
}

test("time warp: timers, intervals, rAF and the clocks move only when advanced", async () => {
    const { page, run } = fakePage();
    run(`window.log = []; window.t0 = performance.now(); window.d0 = Date.now();
         setTimeout(() => log.push("t50:" + (performance.now() - t0)), 50);
         const iv = setInterval(() => { log.push("iv:" + (performance.now() - t0)); if (log.filter(x => x.startsWith("iv")).length === 3) clearInterval(iv); }, 20);
         const gone = setTimeout(() => log.push("never"), 10); clearTimeout(gone);
         requestAnimationFrame((ts) => log.push("raf:" + Math.round(ts - t0)));`);
    assert.deepEqual([...page.log], [], "nothing runs on its own");
    await run("__showcaseAdvance(100 / 3)");
    assert.deepEqual([...page.log], ["iv:20", "raf:33"]);
    await run("__showcaseAdvance(100 / 3)");
    assert.deepEqual([...page.log.slice(2)], ["iv:40", "t50:50", "iv:60"]);
    assert.equal(Math.round(run("performance.now() - t0")), 67);
    assert.ok([66, 67].includes(run("Date.now() - d0")), "Date follows the same clock");
    assert.ok(Math.abs(run("new Date().getTime() - d0") - 67) <= 1);
});

test("time warp: animations are paused and set to the clock, finished at their end", async () => {
    const { anim, run } = fakePage();
    const a = anim(1000);
    await run("__showcaseAdvance(100)");
    assert.equal(a.paused, true);
    assert.equal(a.currentTime, 100, "first seen during this step: one step in");
    await run("__showcaseAdvance(400)");
    assert.equal(a.currentTime, 500);
    const late = anim(Infinity);
    await run("__showcaseAdvance(600)");
    assert.equal(a.finished, true);
    assert.equal(late.currentTime, 600, "an endless animation keeps counting");
});

test("loadTake wants a take; setup is optional; steps are checked", async () => {
    const dir = join(tmpdir(), `showcase-take-${process.pid}`);
    mkdirSync(join(dir, ".showcase"), { recursive: true });
    try {
        writeFileSync(join(dir, ".showcase/config.json"), JSON.stringify({ cdpPort: 9999 }));
        const project = loadProject({ root: dir, argv: [] });
        const f = (name, body) => {
            const file = join(dir, name);
            writeFileSync(file, `module.exports = (c) => (${body});`);
            return file;
        };
        const ok = await loadTake(f("a.cjs", `{ take: [["tap", c.q("#x")]] }`), project, []);
        assert.deepEqual(ok.setup, []);
        assert.deepEqual(ok.take, [["tap", 'document.querySelector("#x")']]);
        await assert.rejects(loadTake(f("b.cjs", "{ setup: [] }"), project, []), /take is missing/);
        await assert.rejects(loadTake(f("c.cjs", `{ take: [["hold", "1"], "oops"] }`), project, []), /take step 2/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
