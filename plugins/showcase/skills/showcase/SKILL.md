---
name: showcase
description: Make pictures and short videos of a web app for people who don't use it - real screenshots of the running app filled with believable demo data, delivered as raw screens, email cards, 16:9 slides or a 20-45 s video clip (edited in OpenScreen), then cleaned up. Works on any stack (Laravel, Django, Rails, Node, WordPress, plain PHP, SPAs and server-rendered apps). Use when asked for screenshots, images, pictures, slides or a demo/how-to video of an app's features - for a client deck, a pitch, a team email, a newsletter, a README, a presentation - or to redo an earlier set for another feature or brand.
---

# Showcase: pictures of an app, from real renders

Everything is a real render of the real app in headless Chrome, filled with planted demo
data. Nothing is drawn, mocked up or retouched: composing only crops and arranges real
screenshots. That is the point. The pictures are honest about what the product does, and
they can be redone in minutes when the UI changes.

The tools are plain Node 22+ with no dependencies, and Chrome (or Edge). They live in
`${CLAUDE_SKILL_DIR}/tools/`. Below, `T=${CLAUDE_SKILL_DIR}/tools`. Run every command
from the project root.

## 0. Is the project set up?

Look for `.showcase/config.json` in the project.

- **Present:** read `.showcase/README.md` first. It holds this project's demo kits, recipes,
  delivered sets and traps, which override the defaults here.
- **Absent:** set the project up first (once per project). Follow
  `reference/project-setup.md`: `node $T/init.mjs`, then the demo kit, with the user.

## 1. Settle the brief (before shooting)

1. **Who looks at it:** a client (polished, no internals, their brand absent or faked) or
   the team (they know the app, so show what CHANGED).
2. **Format:** raw screens (someone else builds the deck), **email cards** (720 px wide,
   pasted in an email body), **slides** (16:9, dropped into PowerPoint/Keynote/Slides) or
   a **video** (a 20–45 s clip of one flow, 9:16 for a phone app or 16:9 for desktop: a
   how-to or a demo). Video: follow `reference/video.md`.
3. **Which features**, and how many. Email: 3, at most 4, one idea per card. Merge or drop
   rather than pile up.
4. **Language** of the card copy follows the reader, not the conversation.
5. **Brand:** never a real customer's data or names in pictures that leave the building.
   Use a demo kit (a fake brand the project already has) or plant a new one.
6. **Devices:** desktop 1440 @2x for admin/back-office screens, phone 390 @3x for whatever
   people use on the go.

When in doubt, make a sensible first set and let the user react. Expect one revision.

## 2. The pipeline

```bash
T=${CLAUDE_SKILL_DIR}/tools
node $T/dev.mjs up                       # app servers (if not running) + the project's Chrome
<kit setup command>                      # from .showcase/config.json "kits": plant demo data
node $T/shoot.mjs .showcase/recipes/<recipe>.cjs [--only a,b] [--out dir] [--kit name]
#   ... LOOK at every shot (Read the PNGs) ...
node $T/compose.mjs .showcase/recipes/<cards>.cjs [--only name] [--out dir]    # cards/slides
#   ... LOOK at every card ...
node $T/dev.mjs down                     # Chrome closed, servers it started stopped, temp swept
```

- Plant the kit right before shooting: demo data often has a time-sensitive state (a shift
  "in progress" that turns stale hours later).
- `shoot.mjs --list` prints a recipe's sections. `node $T/dev.mjs status` shows what runs.
- Writing recipes (the steps, the finders, mocks, signing in): `reference/recipes.md`.
- Cards and slides (crop, layouts, the look, composition rules): `reference/compose.md`.
- Video: `node $T/record.mjs .showcase/recipes/<name>.take.cjs` films a take in a tab of its
  own, then OpenScreen frames, zooms, captions and exports it: `reference/video.md`.

## 3. Look at every picture, like the reader will

Read each PNG before moving on. A shot that "ran fine" can still show a loading spinner, an
empty state, a toast, a cookie banner, a dev toolbar or the wrong tab. The realism checklist
(it caught about 10 problems on the first real set):

- Names: no `demo.`/`test` prefixes, no lorem ipsum, no "Test Client 1". Real-sounding
  people, companies, places for the market the reader is in.
- Numbers tell a story: uneven distributions, a trend, one weak spot. Not all 100 %,
  not all equal.
- Time: timestamps inside office hours, dates near today, nothing "3 years ago".
- Long names truncating, half-loaded charts, empty required fields, broken images.
- Nothing that reads as a failure unless the feature is about failures (a finished task
  with a missing mandatory step, a red badge on every row).
- No real customer names anywhere: placeholders and example text included.

## 4. Deliver

Put the pictures in `<config.out>/<yyyy-mm-dd>-<topic>/` (default `.showcase/out/`,
gitignored), numbered in reading order, file names saying what is shown
(`03-phone-checkin-in-progress.png`). For a client set with several areas, one subfolder
per area.

Tell the user the folder, one line per file saying what it shows, and anything you noticed
but kept out of the pictures (see 6).

## 5. Clean up, in order

1. `node $T/dev.mjs down`. Never stop Chrome or servers any other way: the user's own
   browser must never be closed or killed, and `down` checks that every process on the
   port is this project's Chrome before closing it.
2. Once the pictures are approved, delete the raw and compose folders under `config.work`.
   Keep the kit's ids and mocks only if more shots are likely soon.
3. Demo rows stay in the local database by default (cheap to keep, slow to plant). Say so,
   and give the kit's `clean` command.
4. `git status` must be clean apart from `.showcase/` changes you meant to make.

## 6. Don't hide bugs: report them

Composing makes it tempting to crop around a flaw. Crop around it if the picture needs it,
but tell the user in the delivery, so the bug gets fixed instead of hidden. Wrong labels,
overlapping text, clipped chart labels and a status that contradicts the colour beside it
are all bugs that pictures surface.

## Safety rules (never bend these)

- **Local only.** Demo data is planted in a LOCAL database by a script that refuses any
  other. Never point a kit, a recipe or the tools at production or a shared staging server.
- **No real side effects.** Recipes must not send mail, SMS or push messages, charge
  anything, or write to an external system. Open composers and dialogs; never press
  send/save on them unless the project's notes say that action is local-only.
- **The browser.** Only the project's own headless Chrome, on its own `cdpPort` and its own
  profile folder. If `dev.mjs` refuses because the port is taken, stop and tell the user. If
  it says a browser on the user's REAL profile holds the port, never close or kill it.
- **Chrome exits at once** (code 21, nothing on the port): its profile is in use, or a
  sandbox blocks it. Run `dev.mjs up` outside the sandbox.

## Keep the project's notes current

After a delivery, update `.showcase/README.md`: the set (date, audience, format, what was
liked or cut), any new trap, any new recipe. Notes are state, not a changelog: rewrite
what changed instead of appending history.
