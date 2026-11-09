// The e2e cards: one email card and one slide from the tour's raw shots.
// `raw` is overridden by the test through SHOWCASE_RAW (the shots land in a dated folder).
const raw = process.env.SHOWCASE_RAW ?? ".showcase/out";
const stage = (crop) =>
    [
        crop("01-desktop-dashboard.png", [0, 0, 1000, 300], 0.6, { left: 0, top: 0 }),
        crop("03-phone-orders.png", [0, 0, 390, 500], 0.5, { right: 0, top: 20, lift: true, vw: 390 }),
    ].join("");

module.exports = {
    format: process.env.SHOWCASE_FORMAT ?? "email",
    raw,
    cards: ({ crop }) => [
        { name: "dashboard", eyebrow: "Dashboard", title: "Orders & shares <at a glance>", sub: "One line of context.", height: 300, layout: "top", stage: stage(crop) },
    ],
};
