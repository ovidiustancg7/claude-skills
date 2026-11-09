# Demo kits

One folder per kit (a fake brand with its story), e.g. `demo/acme/`. A kit's setup command
(in `config.json` under `kits`) must:

1. Refuse to run against anything but a LOCAL database.
2. Wipe its own rows (found by a marker: an email domain like `@demo-acme.local`, a code
   range) and plant them fresh. Idempotent: run it right before every shoot.
3. Write into the kit's `dir`:
   - `ids.json`: whatever the recipes need (record ids, the users to sign in as).
   - `session.json` (optional): `{ "<role>": ["<cookie name>", "<cookie value>"] }`.
   - `mocks/*.json` (optional): answers for screens that read a system you cannot run
     locally, produced by the app's real code against faked HTTP so the shapes stay true.
4. Support a clean command that removes the kit's rows and nothing else.

See the skill's `reference/project-setup.md` for per-stack examples.
