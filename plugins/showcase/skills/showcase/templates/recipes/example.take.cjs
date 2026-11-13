// An example video take: replace it with a real flow. Run from the project root:
//   node <skill>/tools/record.mjs .showcase/recipes/example.take.cjs [--out dir]
//
// setup runs in real time, off camera (sign in, pre-fill); take is filmed. The take steps
// (tap, type, scroll, hold, intro, beat, outro, zoom, wait, ...) are in reference/video.md.
module.exports = (c) => ({
    setup: [
        ["size", "390", "844"], // a phone; ["size", "1440", "900"] for desktop
        // ["cookie", ...c.session.user],
        ["go", "/", 2000],
    ],
    take: [
        ["intro", "What this app does, in one line", "APP NAME"],
        ["beat", "The first thing people do", "STEP 1"],
        // ["tap", c.buttonHas("New"), "new"],
        // ["zoom", "on"], ["type", c.q("input[name=title]"), "Weekly report"], ["hold", "800"], ["zoom", "off"],
        ["hold", "2000"],
        ["outro", "The result, in one line"],
    ],
});
