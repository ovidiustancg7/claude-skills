# Recipes: what to shoot

A recipe is a CommonJS module in `.showcase/recipes/`:

```js
module.exports = (c) => ({
    setup: [ /* always runs: sign in, mocks */ ],
    sections: {
        dashboard: [ /* steps */ ],
        phone: [ /* steps */ ],
    },
});
```

`node $T/shoot.mjs <recipe> --only a,b` runs `setup` plus the named sections. `--list`
prints the section names. A new screen is a new section, or a new recipe file: copy the
nearest existing section. Paths in steps are relative to the project root.

## The context `c`

| key | what |
|---|---|
| `c.base` | `baseUrl` from the config |
| `c.ids` | the kit's `ids.json`: whatever the setup planted (record ids, user ids) |
| `c.session` | the kit's `session.json`: `{ role: [cookieName, value] }` |
| `c.mocks` | the kit's mock folder (`<kit dir>/mocks`) |
| `c.raw` | `<kit dir>/raw`: raw shots that a cards spec will crop |
| `c.out` | `--out`, else `<config.out>/<today>`: finished screens |
| `c.today` | `YYYY-MM-DD`, local time |
| `c.kit`, `c.kitDir`, `c.root`, `c.config` | the rest |
| finders | `c.clickText(...)` etc., below, plus the project's own (`config.finders`) |

## Steps

Each step is `[cmd, ...args]`, all strings.

| step | does |
|---|---|
| `go <url> [ms]` | navigate (`/path` is joined to baseUrl). Waits for the document and for an SPA root (`mountSelector`) to get children, then `ms` (default 4000) |
| `nav <route> [ms]` | client-side navigation: Vue Router 3/4, Next, else `pushState` + `popstate` (React Router and most others). Server-rendered apps: use `go` |
| `eval <js>` | run JS in the page (awaited); prints the result. Throwing stops the run |
| `wait <js> [ms]` | poll until the JS is truthy (default timeout 15000). Prefer it over long sleeps |
| `sleep <ms>` | |
| `cookie <name> <value> [url]` | set a cookie for baseUrl (httpOnly allowed, unlike `document.cookie`) |
| `size <w> <h> [dpr]` | viewport. ≤500 px wide = phone (mobile emulation, dpr 3), else dpr 2 |
| `scrollbars off\|on` | hide the page's scrollbars. Cards always do. Use it in a recipe when a raw shot will be shown whole, not cropped |
| `fit` | viewport height = page height, measured once. For whole-page shots where fixed parts (a sidebar) must span the page |
| `shot <file> [full]` | PNG of the viewport, or the whole document with `full` (capped at 5000 css px). Prints `OVERFLOW` when the page is wider than the viewport |
| `mock <urlPart> <file.json> [status]` | answer the page's XHR/fetch calls whose URL contains `urlPart` with that file. Never documents, so a page URL with the same text still loads |
| `rewrite <urlPart> <from> <to>` | replace text in matching real responses (documents included), e.g. a local origin → the production one in share links |
| `file <selector> <path>` | put a file into an `<input type=file>` (a photo upload) |
| `geo <lat> <lng>` | grant geolocation and pin the position (check-in screens) |

## Finders

Apps rarely have stable selectors on what a picture needs, so finders locate things by
visible text. Each returns JS source for `eval` / `wait`:

| finder | |
|---|---|
| `text(t, inside?)` | element whose own text is exactly `t` |
| `textHas(t, inside?)` | own text contains `t` |
| `button(l)` / `buttonHas(l)` | button (or role=button, submit input) by label, any case |
| `click(expr, what)` | click an element expression; throws `not found: what` |
| `clickText(t)` / `clickButton(l)` / `clickButtonHas(l)` / `clickSelector(css)` | the usual clicks |
| `scrollToText(t, offset=80)` | scroll so that text sits `offset` px below the top |
| `typeInto(css, value, enter?)` | set an input/textarea/select the way frameworks hear it |
| `submit(css)` | submit the form around that field |
| `hide(css)` | hide elements that must not be in a picture (dev toolbars, cookie banners) |

`text()` finds the FIRST match in document order. Behind an open modal that is often the
page underneath: pass `inside` (e.g. `"document.querySelector('[role=dialog]')"`) or match
something only the modal has.

A project adds its own in `.showcase/finders.cjs` (config `"finders"`), e.g. a report
builder's "n-th slide thumbnail". They land on `c` next to these.

## Signing in

Pick the first that works for the project:

1. **Mint a session server-side** in the kit's setup (best: no password, no login screen
   in the run). Laravel: boot the app, `session()->put(...)`, print the encrypted cookie.
   Django: `SessionStore` + `SESSION_COOKIE_NAME`. Rails: sign a cookie with the app's
   secret in `bin/rails runner`. Write `session.json` as `{ "admin": [name, value] }`, then
   `["cookie", ...c.session.admin]` in the recipe's setup.
2. **The login form**, in the recipe's setup, with the demo user's password:
   `["go", "/login"]`, `["eval", c.typeInto("input[type=email]", "...")]`, the password
   the same way, `["eval", c.submit("input[type=password]")]`, then
   `["wait", c.textHas("Dashboard")]`.
3. **A token** the SPA keeps in storage: `["go", "/"]`, then
   `["eval", "localStorage.setItem('token', '...')"]`, then `go` again.

Several roles in one recipe (an admin desktop section, a field user's phone section): set
each role's cookie at the start of its section.

## Mocks: what the local machine cannot serve

Some screens read a system the local machine cannot run: an ERP, a payment provider, a
partner API. Don't fake their JSON by hand. Run the app's REAL code against faked HTTP
(Laravel `Http::fake`, Python `responses`, Ruby `webmock`, Node `nock`) and save its exact
output into the kit's `mocks/`. That keeps the shapes and labels true. Then `mock` the
endpoint the browser calls. Re-generate the mocks when that code changes.

## Timing

- A cold dev server (Vite's first load) can take 20 s. `go` waits for the SPA to mount.
  If a shot is still blank, run the section again.
- Use `wait` on the text that proves the screen is ready instead of long `sleep`s.
  Animations (progress bars, charts drawing in) still need a short sleep after it.
