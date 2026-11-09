// The project a showcase runs in: its root (the nearest folder with .showcase/config.json),
// its config with defaults filled in, and the demo kit picked with --kit (or --demo).
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const CONFIG = ".showcase/config.json";

export const DEFAULTS = {
    name: "",
    baseUrl: "http://127.0.0.1:8000",
    cdpPort: null, // required: every project gets its own port (see SKILL.md)
    chrome: null, // path to Chrome/Chromium/Edge; null = look in the usual places
    chromeProfile: ".showcase/.work/chrome-profile",
    work: ".showcase/.work",
    out: ".showcase/out",
    lang: "en",
    mountSelector: "#app, #root, #__next, #__nuxt",
    finders: null, // a project's own finders module, merged into the recipe context
    app: [], // servers `dev.mjs up` starts when they are not already running
    kits: {},
};

/** argv flag value: `--out x` → "x"; absent → undefined. */
export const flag = (name, argv = process.argv) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};

/** The nearest folder at or above `from` that holds .showcase/config.json. */
export function findRoot(from = process.cwd()) {
    let dir = resolve(from);
    for (;;) {
        if (existsSync(join(dir, CONFIG))) return dir;
        const up = dirname(dir);
        if (up === dir) return null;
        dir = up;
    }
}

export function loadProject({ root, argv = process.argv } = {}) {
    root = resolve(root ?? flag("--root", argv) ?? findRoot() ?? "");
    const file = join(root, CONFIG);
    if (!existsSync(file)) {
        throw new Error(`no ${CONFIG} at or above ${process.cwd()}: run the showcase init first (see SKILL.md)`);
    }
    let raw;
    try {
        raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
        throw new Error(`${file} is not valid JSON: ${e.message}`);
    }
    const config = { ...DEFAULTS, ...raw };
    if (!Number.isInteger(config.cdpPort) || config.cdpPort < 1024) {
        throw new Error(`${CONFIG} needs "cdpPort": a free port of this project's own (e.g. 9450)`);
    }
    config.baseUrl = config.baseUrl.replace(/\/+$/, "");
    const abs = (p) => (isAbsolute(p) ? p : resolve(root, p));
    return { root, config, file, abs, kit: pickKit(config, argv) };
}

/**
 * The demo kit: { name, dir (relative to root), setup?, clean? }. --kit/--demo picks one by
 * name; otherwise the kit marked "default", the only kit, or none (a kit-less project still
 * shoots: ids and sessions are just empty).
 */
export function pickKit(config, argv = process.argv) {
    const kits = config.kits ?? {};
    const names = Object.keys(kits);
    const wanted = flag("--kit", argv) ?? flag("--demo", argv);
    let name = wanted;
    if (!name) name = names.find((n) => kits[n].default) ?? (names.length === 1 ? names[0] : undefined);
    if (wanted && !kits[wanted]) throw new Error(`no kit "${wanted}" in ${CONFIG} (have: ${names.join(", ") || "none"})`);
    if (!name) return { name: null, dir: `${config.work}/kit` };
    return { name, dir: kits[name].dir ?? `${config.work}/${name}`, ...kits[name] };
}

/** Today in the machine's local time zone, YYYY-MM-DD (toISOString would give UTC's day). */
export const today = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
