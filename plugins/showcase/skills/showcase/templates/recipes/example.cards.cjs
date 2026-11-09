// An example cards spec: crops of raw shots composed into email cards. Run from the root:
//   node <skill>/tools/compose.mjs .showcase/recipes/example.cards.cjs [--out dir]
//
// crop(file, [x, y, w, h], scale, opts): the rectangle is in the raw's CSS px (desktop shots
// are 1440 wide; pass { vw: 390 } for phone shots). Keep scale at about 0.6 or more so text
// stays readable. opts: left|top|right|bottom, lift (an inset on top), radius, flow, cls, vw.
module.exports = {
    format: "email", // or "slide" (16:9, with layout: "top" | "side" on each card)
    raw: ".showcase/out", // the folder the crops read from
    cards: ({ crop }) => [
        {
            name: "home",
            eyebrow: "Dashboard",
            title: "One plain sentence that says what changed",
            sub: "One line of context for a reader who does not use the app.",
            height: 380,
            stage: [
                crop("01-desktop-home.png", [0, 0, 1440, 900], 0.45, { left: 0, top: 0 }),
                crop("02-phone-home.png", [0, 0, 390, 700], 0.5, { right: 0, top: 30, lift: true, vw: 390 }),
            ].join(""),
        },
    ],
};
