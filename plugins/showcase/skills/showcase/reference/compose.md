# Cards and slides

`compose.mjs` turns raw screenshots into finished pictures: crops of real screens on a
quiet card with one label, one sentence and one line of context.

## The spec

A CommonJS module in `.showcase/recipes/` (name it `<topic>.cards.cjs` / `.slides.cjs`):

```js
module.exports = {
    format: "email",            // or "slide"
    raw: ".showcase/.work/demo/raw/team-email",   // where the crops read from
    out: undefined,             // default output folder (--out wins)
    lang: "en",                 // <html lang>, defaults to config.lang
    css: "",                    // extra CSS for your own stage markup
    theme: {},                  // see "The look"
    cards: ({ crop }) => [
        {
            name: "1-leaves-in-calendar",          // file name
            eyebrow: "Calendar",                   // small label above the title
            title: "Approved leave shows up in the calendar",
            sub: "One line of context for a reader who does not use the app.",
            height: 380,                           // email: the stage height in px
            // slide: layout: "top" | "side", stageTop: 236
            stage: crop("cal-week.png", [120, 140, 1100, 520], 0.6, { left: 0, top: 0 })
                 + crop("drawer.png", [960, 0, 480, 700], 0.5, { right: 0, top: 30, lift: true }),
        },
    ],
};
```

`crop(file, [x, y, w, h], scale, opts)` shows that rectangle of a raw shot. The rectangle
is in the raw's **CSS px**: desktop shots are 1440 wide, phone shots need `vw: 390`. The
height is read from the PNG. Options:

| opt | |
|---|---|
| `left` `top` `right` `bottom` | position in the stage (px) |
| `lift` | a deeper shadow, for an inset on top of another crop |
| `radius` | corner radius (CSS value) |
| `flow` | no frame, in normal flow: for your own flex/grid markup (with `css`) |
| `cls` | extra class |
| `vw` | the raw's CSS width (default 1440) |

`.window` is a ready-made frame for a condensed app window: put a bar and body of `flow`
crops inside it (your own markup and `css`).

## Formats

| format | size | for |
|---|---|---|
| `email` | 720 css wide, height fits → 1440 px | pasted into an email body |
| `slide` | 1280×720 css → 2560×1440 px | a 16:9 slide, `layout: "top"` (text above) or `"side"` (text in a left column) |

Every output is tagged 192 dpi. Outlook and Word paste a 1440 px card at 720 px (sharp on
retina screens, normal size on the page). PowerPoint takes a 2560 px slide as exactly
13.33" wide. Gmail ignores dpi and fits the column.

## The look

The default is the changelog-card register of Linear's and Vercel's changelog images: a
warm `#F2F1EC` ground, a small lime-square eyebrow, one plain sentence as the title, one
line of context, real screens in hairline frames with soft shadows. No gradients, glows,
stock icons, emoji or arrows. Name this inspiration when presenting new cards.

`theme` overrides it per spec: `{ ground, ink, muted, sub, accent, font, fontUrl }`
(`fontUrl: null` = system font, no web request). Match a client's brand only when asked,
and then only colours and font, never their logo.

## Composition rules (each learned on a rejected render)

- **Crop tight** so text keeps a scale of about 0.6 or more. A whole 1440 screen shrunk to
  720 is unreadable.
- **An inset must never cover the point of the picture.** A drawer once hid the very thing
  the card was about, then the person's name. Check the overlap, not just the frame.
- **Crop past a scrollable panel's scrollbar** (grey ticks at the edge). Cut an email or a
  list just above a button, not through it.
- **Condensing beats snippets.** A builder shown as a condensed window (header bar, the key
  panel parts, the result) reads better than two floating fragments.
- **One card, one idea.** If a card needs a paragraph, it is two cards, or a sentence in
  the email around it.
- **Fewer cards.** A card that only matters to the people who built the feature gets cut.
