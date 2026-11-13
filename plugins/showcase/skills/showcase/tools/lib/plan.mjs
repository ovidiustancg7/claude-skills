// The edit plan of a take: what record.mjs saw happen, in video seconds, shaped for the
// OpenScreen edit described in reference/video.md. Pure functions, unit-tested.
//
// marks, logged by the take as it runs (t in seconds of video):
//   { kind: "intro" | "outro" | "beat", t, headline, kicker }
//   { kind: "zoom-on", t, scale, focus? }   focus: { cx, cy } of an element, frame fractions
//   { kind: "zoom-off", t }
//   { kind: "tap", t, cx, cy, label }

/** OpenScreen's zoom move, in seconds: 0.6 s + 0.55 s × ln(scale). */
export const zoomMove = (scale) => 0.6 + 0.55 * Math.log(scale);

const round = (x) => Math.round(x * 100) / 100;
const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Caption spans: a beat lasts until the next caption starts, or the end. An intro or outro
 * lasts its own hold (`end`), so a title never covers the action that follows it.
 */
export function captions(marks, duration) {
    const cues = marks.filter((m) => ["intro", "beat", "outro"].includes(m.kind));
    return cues.map((m, i) => ({
        style: m.kind === "beat" ? "beat" : m.kind,
        start: round(m.t),
        end: round(Math.min(m.end ?? Infinity, i + 1 < cues.length ? cues[i + 1].t : duration)),
        headline: m.headline,
        ...(m.kicker ? { kicker: m.kicker } : {}),
    }));
}

/**
 * Zoom spans. A zoom HOLDS over [start, end] and animates in before start and out after end,
 * so the hold is inset by one move on each side: the camera starts moving at "zoom on" and
 * is back on the whole phone at "zoom off". Focus: the element named at "zoom on", else the
 * median of the taps inside the span, else the centre.
 */
export function zooms(marks, duration) {
    const out = [];
    let open = null;
    const close = (t) => {
        const move = zoomMove(open.scale);
        const start = open.t + move;
        const end = t - move;
        if (end - start < 0.3) throw new Error(`zoom at ${round(open.t)} s is too short: hold it at least ${round(2 * move + 0.3)} s`);
        const taps = marks.filter((m) => m.kind === "tap" && m.t >= open.t && m.t <= t);
        const focus = open.focus ?? (taps.length ? { cx: median(taps.map((m) => m.cx)), cy: median(taps.map((m) => m.cy)) } : { cx: 0.5, cy: 0.5 });
        out.push({ start: round(start), end: round(end), scale: open.scale, focus: { cx: round(focus.cx), cy: round(focus.cy) } });
        open = null;
    };
    for (const m of marks) {
        if (m.kind === "zoom-on") {
            if (open) close(m.t);
            open = m;
        } else if (m.kind === "zoom-off" && open) close(m.t);
    }
    if (open) close(duration);
    return out;
}

export function buildPlan({ video, width, height, fps, frames, viewport, marks }) {
    const duration = round(frames / fps);
    return {
        video,
        width,
        height,
        fps,
        duration,
        viewport,
        captions: captions(marks, duration),
        zooms: zooms(marks, duration),
        taps: marks.filter((m) => m.kind === "tap").map(({ t, cx, cy, label }) => ({ t: round(t), cx: round(cx), cy: round(cy), label })),
    };
}

/**
 * The pointer sidecar OpenScreen reads next to a video (<video>.cursor.json): one sample per
 * frame, cx/cy as fractions of the frame, a click as "click" then "mouseup" 80 ms later.
 */
export function cursorSidecar(samples) {
    return {
        version: 2,
        provider: "native",
        samples: samples.map((s) => ({
            timeMs: Math.round(s.timeMs),
            cx: Math.round(s.cx * 10000) / 10000,
            cy: Math.round(s.cy * 10000) / 10000,
            visible: s.visible,
            assetId: null,
            cursorType: null,
            interactionType: s.type ?? "move",
        })),
        assets: [],
    };
}
