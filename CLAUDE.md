# CLAUDE.md

Claude Code skills shared as a plugin marketplace (`ovidiu-skills`), private on GitHub.
Everything in this repo is written in English. The guidance (SKILL.md, references,
READMEs, this file, examples) names no person and no company; the owner's name belongs
only in author fields (`plugin.json`, `marketplace.json`) and commit authorship.

## What lives here

Skills that help on more than one project or stack. A skill that only makes sense for one
project stays in that project's `.claude/skills/`. When a project skill turns out to be
useful elsewhere, propose moving it here; don't move it without asking.

| plugin | what | state |
|---|---|---|
| `showcase` | real screenshots of any web app with demo data, as raw screens, email cards or 16:9 slides | v1.1, proven on a Laravel + Vue SPA and a server-rendered PHP app |

## Layout

```
.claude-plugin/marketplace.json     marketplace "ovidiu-skills": lists every plugin
plugins/<plugin>/
  .claude-plugin/plugin.json        name, version, description
  README.md                         for humans browsing GitHub
  skills/<skill>/SKILL.md           what Claude reads (frontmatter description = when it triggers)
  skills/<skill>/reference/*.md     detail SKILL.md points to, read on demand
  skills/<skill>/tools/             scripts, referenced as ${CLAUDE_SKILL_DIR}/tools/...
  skills/<skill>/templates/         files a skill copies into a project
tests/unit/  tests/e2e/             node:test suites, one folder per kind
```

A new plugin = a folder under `plugins/`, an entry in `marketplace.json`, a row in the
README's table and in the table above.

## Rules for every skill here

- **Stack-neutral.** Nothing assumes one framework, one OS or one company. Project
  specifics live in the project (showcase uses a `.showcase/` folder there) and the skill
  reads them.
- **No dependencies** unless one saves real work: plain Node 22+ (built-in WebSocket,
  `node:test`, `zlib.crc32`), so installing a plugin needs nothing else.
- **Cross-platform**: Windows, macOS, Linux.
- **SKILL.md stays short** (the method, the pipeline, the safety rules); details go to
  `reference/`. The `description` says what it does AND when to use it.
- **Safe by default**: local data only, never real sends, never touch a browser or a
  process the tool did not start (see showcase's `lib/chrome.mjs` for the pattern).

## Commands

```bash
npm test               # unit tests (no browser)
npm run test:e2e       # e2e: tests/e2e/fixture-app + real headless Chrome on :9450 (9451 for the squatter test)
npm run test:all       # both; must be green before every commit
claude plugin validate .                    # the marketplace
claude plugin validate plugins/<plugin>     # a plugin
```

Chrome may need to run outside the Bash sandbox (it exits 21 silently inside it).

## Releasing a change

1. Tests green, both validations pass.
2. Bump `version` in the plugin's `plugin.json` (semver: a new step or option = minor, a
   fix = patch). Installs only update when the version changes.
3. Commit and push to `main`. Users run `/plugin marketplace update ovidiu-skills` (or wait
   for the background update).
4. To try a change before pushing: `/plugin marketplace add <path to this folder>` in a
   test session, or run the tools directly from this folder against a project.

## Showcase lessons (now covered by tests)

- Mocks answer XHR/fetch only: a page URL containing the mocked text once got the JSON.
- Cards hide scrollbars: a headless Chrome kept painting one after `fit` grew the viewport.
- A project's own test harness (throwaway database, sends recorded) is the safest place
  for a demo kit: the server-rendered PHP app was shot that way.
