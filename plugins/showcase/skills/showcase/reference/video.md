# Video: a short clip of the real app

A 20–45 s clip of one flow in the real app, filled with demo data: a how-to for the people
who use the app, or a demo for a client or management. `record.mjs` films it in the
project's headless Chrome. OpenScreen (a screen-recording editor with an MCP server) adds
the frame, the pointer, the zooms and the captions, then exports the MP4.

Nothing is screen-recorded. Every frame is a full-resolution screenshot (a phone at 390 @3x
gives 1170×2532), taken on a frame clock that makes the page move exactly 1/30 s per frame.
So the clip is sharp enough to zoom, every take is identical, and the edit can use exact
seconds from the take.

## 0. Before you start

- **OpenScreen** must be installed with its MCP server registered (tools named
  `mcp__openscreen__*`). Without it, `record.mjs` still makes the WebM. Say so and offer the
  raw clip.
- If `openscreen mcp` fails from an editor's terminal with `Cannot find module`, the
  editor exported `ELECTRON_RUN_AS_NODE=1`. Register the server through a shell that removes
  it (on Windows: `cmd /d /c "set ELECTRON_RUN_AS_NODE=&& openscreen mcp"`).
- `dev.mjs up` as for stills, and the kit planted.

## 1. Plan the story (with the user)

- **One flow, one example of each kind of thing.** A form with ten similar questions shows
  one of each type, never the same thing ten times. Fill the repetitive parts OFF camera in
  `setup` (most apps keep a draft) so the take still finishes and submits for real.
- **Find what is required before filming.** Tap submit on the empty form during setup or a
  trial run: the client-side check names the required fields. Watch conditional rules
  (answering "yes" can make a photo mandatory).
- **3 to 6 beats**, each a caption: a kicker (`STEP 1`, `PHOTO`) and a headline the reader
  understands without the app (`Measure the shelf`). Headlines fit one line: about 24
  characters. Shorten them; don't shrink the font. Copy follows the reader's language.
- An **intro** title (2.5 s) and an **outro** with the result ("Sent. Straight into the report").
- **Zoom** only where the eye must land on something small: typing a value, a toggle. Two
  or three zooms per clip, never one per beat.

## 2. Write the take

`.showcase/recipes/<name>.take.cjs`:

```js
module.exports = (c) => ({
    setup: [                                   // real time, not filmed
        ["size", "390", "844"],                // a phone (default); 1440 900 for desktop
        ["cookie", ...c.session.promoter],
        ["go", "/forms/42"],
        ["eval", "/* pre-fill the repetitive answers */"],
        ["wait", c.textHas("Shelf audit")],
    ],
    take: [                                    // filmed
        ["intro", "Shelf audit, from the phone", "FIELD APP"],
        ["beat", "Measure the shelf", "STEP 1"],
        ["zoom", "on"],
        ["type", c.q("#shelf-length"), "240"],
        ["hold", "800"],
        ["zoom", "off"],
        ["beat", "A photo when it matters", "STEP 2"],
        ["tap", c.button("Yes"), "fridge yes"],
        ["file", "input[type=file]", ".showcase/.work/demo/shelf.jpg"],
        ["scroll", c.button("Send")],
        ["tap", c.button("Send"), "send"],
        ["wait", c.textHas("Sent")],
        ["outro", "Sent. Straight into the report"],
    ],
});
```

Take steps (all strings, like every recipe):

| step | does |
|---|---|
| `tap <js> [label]` | scrolls the element into the upper middle if needed, glides the pointer to it, presses, releases (real input events) |
| `type <js> <text> [msPerChar]` | taps the field, then types one character at a time (70 ms each) |
| `scroll <js\|px> [ms]` | eases the element to ~40 % of the screen height inside its own scroll container, or scrolls the page by px (900 ms) |
| `hold <ms>` | the screen sits; `sleep` does the same inside a take |
| `intro` / `outro <headline> [kicker] [ms]` | a title over the screen, held 2500 ms |
| `beat <headline> [kicker]` | a caption from here to the next beat/outro |
| `zoom on [scale] [js]` / `zoom off` | a zoom over the steps between (scale from `config.video.zoom`, else 1.3), centred on the element, else on the taps inside |
| `wait <js> [ms]` | films until the JS is truthy (a save, a toast) |
| `nav`, `go`, `eval`, `mock`, `file`, `geo`, `cookie` | as in recipes; `nav`/`go` keep filming while the page loads |

`<js>` is a finder that returns an element: `c.q(css)`, `c.text(...)`, `c.textHas(...)`,
`c.button(...)`, `c.buttonHas(...)`. `size`, `fit` and `shot` belong in setup.

## 3. Record

```bash
node $T/record.mjs .showcase/recipes/<name>.take.cjs [--out dir] [--kit name] [--fps 30] [--keep-frames]
```

About 2.5× real time (a 30 s clip in ~75 s), then a few seconds to encode. It writes into
`<out>` (default `<config.out>/<today>`):

- `<name>.webm`: the clip (VP9, from Chrome's own encoder);
- `<name>.webm.cursor.json`: the pointer, one sample per frame. OpenScreen reads it when it
  opens the WebM and draws its own cursor from it;
- `<name>.plan.json`: `captions` (style, start, end, headline, kicker), `zooms` (start, end,
  scale, focus) and `taps`, all in video seconds.

Look at a few frames before editing (`getFrames` with `path` = the WebM, or after step 4).
A tap that missed, a spinner or an error toast means fix the take and record again: it costs
a minute.

## 4. Edit in OpenScreen

Every call takes the `projectId` from the first one.

1. `createProject` with `videoPath` = `plan.video` and a title. It reads the pointer and
   plans its own zooms on the taps: `getCurrentDocument`, then `removeModifier` each
   `zoomRanges` id. Then `createCheckpoint`.
2. `setEditorSettings`:
   - a phone clip: `aspectRatio "9:16"`, `frame "phone"`, `frameTheme "dark"`, `padding 58`;
     desktop: `aspectRatio "16:9"`, `frame "window"`, `padding 8`.
   - `wallpaper`: `config.video.wallpaper`, else a dark radial gradient in the app's colours
     (`radial-gradient(circle at 50% 30%, <dark tint> 0%, <darker> 55%, #07080f 100%)`),
     `wallpaperMotion "none"`.
   - `cursor`: `{ show: true, theme: "glass-lens", size: 3.2, clickImpact: false, clickBounce: 0.4 }`.
3. `addZooms` with every `plan.zooms` entry as
   `{ startSec: start, endSec: end, customScale: scale, focus }`. The plan already insets
   the hold so the camera starts moving at "zoom on" and is back by "zoom off".
4. **Captions**, for each `plan.captions` entry, two text annotations over `start`–`end`,
   both `bold: true`, `background: "none"`, `x: 50`:

   | | headline | kicker |
   |---|---|---|
   | beat | `y 10`, `fontSize 44`, `color` ink, `animation "rise"` | `fontSize 22`, `color` accent, `animation "fade"` |
   | intro | `y 50`, `fontSize 64` (two lines at most, split with `\n`), ink, `"rise"` | `fontSize 24`, accent, `"fade"` |
   | outro | as the intro, but `y 72`: the result on screen (a "sent" toast, a "done" badge) is the proof and stays visible | as the intro |

   The kicker sits above the headline: kicker `y` = headline `y` − (headline height +
   kicker height) / 2 − 2, with both heights read from the headline's `addAnnotation`
   result and a first kicker call (then `setAnnotation` its `y`). No kicker: skip it.
5. **Plates**, drawn by `templates/video/plates.wgsl`, under the text:
   - the first span: `addEffect` with `effect` = `{ name: "Caption plates", description,
     code: <the file>, params }` and `values`;
   - every later span: `addEffect` with the returned `effectId` and its own `values`.

   `params`: `head_c` point, `head_w` / `head_h` numbers 0–1 (head_h max 0.5), `head_col`
   color, `kick_c` point, `kick_w` / `kick_h` numbers 0–1 (kick_h max 0.2), `kick_col`
   color, `dim` number 0–0.85. `values`, from the annotations' boxes (percent → fraction):
   `head_c {x: x/100, y: y/100}`, `head_w width/100`, `head_h height/100`, the same for the
   kicker (`kick_w 0` when there is none), `head_col` = accent, `kick_col` = ink, `dim` 0.55
   for the intro, 0.3 for the outro (its result must stay readable) and 0 for beats.
6. `exportVideo` (`fps 30`, `quality "good"`: 1080×1920) to `<out>/<name>.mp4`. Then
   `getFrames` (projectId) at the middle of every caption and every zoom hold, and look at
   them like the reader will: text inside its plate, kicker clear of the headline, the
   zoom on the action, the pointer on what is tapped.

Accent and ink: `config.video.accent` / `config.video.ink`, else the app's brand colour and
its darkest text colour. The accent must be light enough for dark text on it.

## The look (decided, don't reintroduce)

- No 3D tilt (`rotationPreset` stays `none`) and no click shake (`clickImpact: false`).
- The glass-lens pointer, a small bounce on taps.
- Zooms around 1.3× (1.5× at most): enough to read a field, without losing the phone.
- One caption per beat, plates for every caption, nothing floating on the bare picture.

## Deliver and clean up

- The MP4 in `<out>`, with one line per beat saying what it shows. Mention the OpenScreen
  project by title: the user can open it in OpenScreen's editor for small changes.
- Keep the WebM while that project is in use: the project reads it from there.
- Frames are deleted after encoding (kept with `--keep-frames`, in `<work>/video/<name>`).
- Demo rows the take created (an uploaded photo, a submitted form) stay in the local
  database: say so, and how to remove them if the kit's `clean` doesn't.

## When something is off

- **What the frame clock does not slow down:** network (responses arrive during the real
  time each frame takes, which looks natural), `<video>` playback, the caret, and native
  smooth scrolling (forced off; `scroll` and `tap` tween instead). Timers an app started
  before the take keep real time until they fire once.
- `frame N: no screenshot in 20 s`: the tab hung. Run `dev.mjs down` and `up`, then again.
- `the video would be W×H`: pick a viewport whose size × dpr is even on both sides.
- Pointer off target in OpenScreen: the sidecar must sit next to the WebM, named
  `<name>.webm.cursor.json`, before `createProject`.
