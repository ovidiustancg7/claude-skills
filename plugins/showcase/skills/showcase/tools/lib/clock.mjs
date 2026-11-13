// A frame clock for video: the page only moves when a frame is taken, so every frame lands
// exactly 1/fps apart however slow a full-resolution screenshot is (~80 ms at 1170×2532).
//
// The page's sense of time is replaced in JavaScript (TIME_WARP below, installed for the
// current document and every one the take opens): setTimeout/setInterval, Date,
// performance.now and requestAnimationFrame run on a virtual clock that advances one frame
// per step, and every CSS transition/animation and Web Animation is paused and set to that
// clock's time (document.getAnimations()). Chrome itself keeps rendering in real time, so a
// screenshot never waits on a paused clock.
//
// Why not Chrome's own virtual time (Emulation.setVirtualTimePolicy)? CSS animations ignore
// it, and in new headless one screenshot in a few hundred never returns under it.
//
// Not warped: network (a response arrives during the real time a frame takes, which looks
// natural), native smooth scrolling (record.mjs forces it off and tweens scrolls itself),
// media playback and the text caret.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sleep } from "./cdp.mjs";
import { frameName } from "./encode.mjs";

export const TIME_WARP = `(() => {
  if (window.__showcaseAdvance) return;
  const realPerf = performance.now.bind(performance);
  const realDateNow = Date.now;
  const RealDate = Date;
  const T = { now: realPerf(), perf0: realPerf(), epoch0: realDateNow(), seq: 1, timers: new Map(), raf: [], anims: new WeakMap() };
  const epoch = () => T.epoch0 + (T.now - T.perf0);
  performance.now = () => T.now;
  function VDate(...a) {
    if (!new.target) return new RealDate(epoch()).toString();
    return a.length ? new RealDate(...a) : new RealDate(epoch());
  }
  VDate.prototype = RealDate.prototype;
  VDate.now = () => Math.floor(epoch());
  VDate.parse = RealDate.parse;
  VDate.UTC = RealDate.UTC;
  window.Date = VDate;
  const add = (fn, ms, args, every) => {
    const id = T.seq++;
    T.timers.set(id, { at: T.now + Math.max(0, Number(ms) || 0), fn, args, every, order: id });
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, null);
  window.setInterval = (fn, ms, ...args) => add(fn, ms, args, Math.max(1, Number(ms) || 0));
  window.clearTimeout = window.clearInterval = (id) => { T.timers.delete(id); };
  window.requestAnimationFrame = (cb) => { const id = T.seq++; T.raf.push({ id, cb }); return id; };
  window.cancelAnimationFrame = (id) => { T.raf = T.raf.filter((r) => r.id !== id); };
  const call = (t) => { try { typeof t.fn === "function" ? t.fn(...t.args) : (0, eval)(String(t.fn)); } catch (e) { console.error(e); } };
  window.__showcaseAdvance = async (ms) => {
    const from = T.now;
    const end = T.now + ms;
    for (let guard = 0; guard < 5000; guard++) {
      let next = null;
      for (const [id, t] of T.timers) if (t.at <= end && (!next || t.at < next.t.at || (t.at === next.t.at && t.order < next.t.order))) next = { id, t };
      if (!next) break;
      T.now = Math.max(T.now, next.t.at);
      if (next.t.every !== null) { next.t.at += next.t.every; next.t.order = T.seq++; } else T.timers.delete(next.id);
      call(next.t);
      await null; // let the callback's promises settle before the next timer
    }
    T.now = end;
    const frame = T.raf; T.raf = [];
    for (const r of frame) { try { r.cb(T.now); } catch (e) { console.error(e); } }
    await null;
    for (const a of document.getAnimations()) {
      let s = T.anims.get(a);
      if (!s) { s = { start: from }; T.anims.set(a, s); a.pause(); }
      const t = T.now - s.start;
      const endTime = a.effect && a.effect.getComputedTiming().endTime;
      if (Number.isFinite(endTime) && t >= endTime) { if (a.playState !== "finished") a.finish(); }
      else a.currentTime = t;
    }
    return T.now;
  };
})()`;

export async function startClock(page, { fps = 30, dir, quality = 92, viewport }) {
    const { send, evaluate } = page;
    const step = 1000 / fps;
    mkdirSync(dir, { recursive: true });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: TIME_WARP });
    await evaluate(TIME_WARP);

    const pointer = { x: viewport.width / 2, y: viewport.height * 0.7, visible: false };
    const samples = [];
    let pendingType = null;
    let count = 0;

    async function frame() {
        // During a navigation the new document may not have its clock yet: just film it.
        await evaluate(`window.__showcaseAdvance ? window.__showcaseAdvance(${step}) : 0`).catch(() => {});
        const { data } = await Promise.race([
            send("Page.captureScreenshot", { format: "jpeg", quality, optimizeForSpeed: true }),
            sleep(20000).then(() => {
                throw new Error(`frame ${count}: no screenshot in 20 s`);
            }),
        ]);
        writeFileSync(join(dir, frameName(count)), Buffer.from(data, "base64"));
        samples.push({
            timeMs: count * step,
            cx: pointer.x / viewport.width,
            cy: pointer.y / viewport.height,
            visible: pointer.visible,
            type: pendingType ?? "move",
        });
        pendingType = null;
        count++;
    }

    return {
        step,
        frame,
        async hold(ms) {
            const n = Math.max(1, Math.round(ms / step));
            for (let i = 0; i < n; i++) await frame();
        },
        /** Seconds of video so far. */
        now: () => (count * step) / 1000,
        get count() {
            return count;
        },
        pointer,
        /** The next frame's pointer sample carries this interaction ("click", "mouseup"). */
        mark(type) {
            pendingType = type;
        },
        samples,
    };
}
