# showcase

Pictures of a web app for people who don't use it: a client deck, a pitch, a team email,
a README. Claude drives the real app in headless Chrome, filled with planted demo data,
and delivers:

- **raw screens**: desktop 1440 @2x, phone 390 @3x, named and numbered;
- **email cards**: 720 px crops of real screens on a quiet card with a one-line title,
  sharp when pasted into Outlook or Gmail;
- **slides**: 16:9, ready to drop into PowerPoint, Keynote or Google Slides.

Nothing is drawn or retouched, so the pictures stay honest and can be redone in minutes
when the UI changes.

## How it fits a project

Everything project-specific lives in the project, in `.showcase/`:

- `config.json`: how the app starts, its URL, its own Chrome port.
- `demo/<kit>/`: a script that plants a fake brand (people, places, a few weeks of
  activity) into the **local** database, through the app's own models.
- `recipes/`: which screens to shoot and how to compose them.
- `README.md`: notes for the next shoot.

The skill sets this up with you the first time (`tools/init.mjs` recognizes Laravel,
Next.js, Vite, Django, Rails, plain PHP and WordPress).

## Tools

All in `skills/showcase/tools/`, Node 22+, no dependencies:

| tool | |
|---|---|
| `init.mjs` | scaffold `.showcase/` in a project |
| `dev.mjs up / down / status` | start the app's servers and the project's own headless Chrome; stop only what it started |
| `shoot.mjs <recipe>` | run a recipe: navigate, sign in, mock, click, screenshot |
| `compose.mjs <cards>` | crop raw shots into email cards or slides, 192 dpi |

## Safety

- Demo data only ever goes into a local database; kit scripts refuse anything else.
- The tools only drive a Chrome they started, on the project's own port and profile
  folder. They never close or kill a browser on your everyday profile.
- Recipes open composers and dialogs but never send mail or write to external systems.
