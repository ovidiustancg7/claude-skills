# Setting a project up (once)

Everything project-specific lives in the project's `.showcase/` folder, committed with the
code:

```
.showcase/
  config.json        how to start the app, the Chrome port, the kits
  README.md          notes for the next shoot: kits, recipes, delivered sets, traps
  finders.cjs        optional: the project's own finders
  demo/<kit>/        the scripts that plant each demo kit
  recipes/           what to shoot (*.cjs) and how to compose it (*.cards.cjs)
  .gitignore         .work/ and out/
  .work/  out/       generated (ignored): kit data, raw shots, logs, deliveries
```

## 1. Scaffold

```bash
node $T/init.mjs [--port 9450] [--name "App name"]
```

It recognizes Laravel (+Vite), Next.js, Vite, Django, Rails, plain PHP (with
`router.php`) and WordPress, fills in how to start the app, picks a free CDP port from
9450 up, and never overwrites a file. Then review `config.json` with the user.

**The CDP port** must be the project's own and stable: two projects' Chromes on one port
would drive each other. If the user keeps a port registry (often in their CLAUDE.md), take
the next free one from it and add the project there.

## 2. config.json

| key | default | |
|---|---|---|
| `name` | folder name | |
| `baseUrl` | `http://127.0.0.1:8000` | where the app answers |
| `cdpPort` | (required) | the project's own Chrome port |
| `chrome` | auto | path to Chrome/Chromium/Edge (or env `SHOWCASE_CHROME`) |
| `chromeProfile` | `.showcase/.work/chrome-profile` | fixed, reused, gitignored |
| `work` | `.showcase/.work` | logs, compose pages, dev state |
| `out` | `.showcase/out` | deliveries (`<out>/<date>` by default) |
| `lang` | `en` | the cards' `<html lang>` |
| `mountSelector` | `#app, #root, #__next, #__nuxt` | the SPA root `go` waits for |
| `finders` | none | the project's own finders module |
| `app` | `[]` | servers `dev.mjs up` starts when they are not already answering |
| `kits` | `{}` | demo kits, see below |

An `app` entry: `{ name, url | file, cmd: [exe, ...args], cwd?, env?, shell?, cleanup? }`. `url`
(or a `file` that appears, like Vite's `public/hot`) says it is up. `cmd[0] = "node"` runs
this Node. `env` adds environment variables (e.g. the switch that points the app at a demo
database). `shell: true` for npm scripts. `cleanup` lists files to remove after stopping it.
`up` starts only what does not answer, so the user's own running dev server is reused, and
`down` stops only what `up` started.

Apps that cannot be started by one command (WordPress in Docker or XAMPP, a stack behind
a proxy): leave `app` empty, set `baseUrl`, and start them the usual way.

A kit: `{ default?, dir, setup, clean }`. `dir` is where its setup writes (`ids.json`,
`session.json`, `mocks/`, and `raw/` for the shots). `--kit <name>` picks one. Without it,
the kit marked `default`, or the only one, is used.

## 3. The demo kit: believable data, planted locally

A kit is a fake brand with a story: a company, its people, its places, a few weeks of
activity. It is planted into the LOCAL database by a script in the project's own language,
so it goes through the same models and rules as real data.

**The script must:**

1. **Refuse anything but local.** Check the environment AND the database (name or host)
   before writing a single row. Exit loudly otherwise.
2. **Find its own rows by a marker** (an email domain like `@demo-acme.local`, a code range
   like `RO 99999xxx`, a slug prefix), wipe them, and plant fresh. Idempotent: it runs
   before every shoot.
3. **Write `ids.json`** with what the recipes need, and `session.json` if it mints sessions.
4. **Support `--clean`** (or a separate command): remove the kit's rows and nothing else.
5. **Never send anything**: no mail, no queued notifications, no webhooks. Fake or disable
   them for the run.

**Per stack:**

| stack | how |
|---|---|
| Laravel | a PHP script that boots the app (`require vendor/autoload.php`, `bootstrap/app.php`, `$kernel->bootstrap()`), checks `app()->environment('local')` and the DB name, then uses the models. `Mail::fake()`, `Notification::fake()`, `Event::fake([...])` against side effects |
| Django | a management command; check `settings.DEBUG` and `DATABASES['default']['NAME']` |
| Rails | `bin/rails runner .showcase/demo/acme/seed.rb`; check `Rails.env.development?` |
| Node (Prisma, Drizzle, Knex, …) | a script using the app's own client; check `NODE_ENV` and the URL's host |
| WordPress | `wp eval-file .showcase/demo/acme/seed.php` (WP-CLI): `wp_insert_post`, `wp_insert_user`, `update_option`; check `WP_ENVIRONMENT_TYPE` / `DB_HOST` |
| plain PHP | PDO with the app's config; check the DB name and host |

**Look for a test harness first.** Many projects already build a throwaway database with
mail, SMS and third-party calls faked, for their own HTTP or browser tests. Planting the kit
through that harness and serving it with the harness's server (an `app` entry with `env`)
is the safest setup there is: the dev database and live credentials are never in reach.

**If the local database holds data that must not mix with a demo** (a copy of production,
personal data): plant into a separate local demo database and point the app at it for the
shoot (an env var or config switch the app already has). Say so in the README.

**Make it believable** (see SKILL.md's realism checklist):

- Names that fit the market (Romanian names for a Romanian audience, and so on). Real-
  sounding companies, but never a real client's name unless the user asks for it.
- Anchor dates to TODAY (relative), so the kit never goes stale. Stories that need a
  fixed season (Q4, a campaign) should be shifted forward when they run out.
- Uneven numbers with a story: one region ahead, one behind, a trend over weeks.
- A "live" state where it matters: something in progress right now, something done this
  morning, something scheduled tomorrow.
- Fill every field a screen shows. An empty photo or a missing avatar reads as broken.

## 4. The README

`.showcase/README.md` is what the next session reads first. Keep in it: each kit (brand,
users, the story, what it cannot show), each recipe (one line), each delivered set (date,
audience, format, what was liked or cut), and the project's traps.
