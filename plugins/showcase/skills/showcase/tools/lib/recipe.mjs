// Recipes: what to shoot. A recipe is a CommonJS module
//   module.exports = (ctx) => ({ setup: [...steps], sections: { name: [...steps] } })
// `setup` always runs; then every section, or only those named with --only a,b.
// A plain .json file holding an array of steps works too.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { flag, today } from "./project.mjs";

const require = createRequire(import.meta.url);

/** The context handed to a recipe: where things are, what the kit planted, the finders. */
export function recipeContext(project, argv = process.argv, { lenient = false } = {}) {
    const { root, config, kit } = project;
    const planted = existsSync(join(root, kit.dir));
    if (kit.name && !planted && !lenient) {
        throw new Error(`${kit.dir} is missing: plant the "${kit.name}" kit first (${kit.setup ?? "its setup"})`);
    }
    // Listing sections before the kit exists: any session role reads as an empty cookie pair.
    const empty = (value) => new Proxy({}, { get: (_, k) => (typeof k === "string" ? value : undefined) });
    const json = (rel, fallback) => {
        const f = join(root, kit.dir, rel);
        return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : fallback;
    };
    const finders = require("../finders.cjs");
    const own = config.finders ? require(resolve(root, config.finders)) : {};
    return {
        root,
        config,
        kit: kit.name,
        kitDir: kit.dir,
        base: config.baseUrl,
        ids: json("ids.json", lenient ? empty(undefined) : {}),
        session: json("session.json", lenient ? empty([]) : {}),
        mocks: `${kit.dir}/mocks`,
        raw: `${kit.dir}/raw`,
        out: flag("--out", argv) ?? `${config.out}/${today()}`,
        today: today(),
        ...finders,
        ...own,
    };
}

/** Section names, for --list (works before the kit is planted). */
export async function listSections(file, project, argv = process.argv) {
    const recipe = await loadRecipe(file, recipeContext(project, argv, { lenient: true }));
    return Object.keys(recipe.sections ?? {});
}

/** The flat list of [cmd, ...args] steps to run. */
export async function loadSteps(file, project, argv = process.argv) {
    if (/\.json$/i.test(file)) return JSON.parse(readFileSync(file, "utf8"));
    const recipe = await loadRecipe(file, recipeContext(project, argv));
    const sections = recipe.sections ?? {};
    const only = flag("--only", argv)?.split(",").filter(Boolean);
    const unknown = (only ?? []).filter((k) => !sections[k]);
    if (unknown.length) throw new Error(`no such section: ${unknown.join(", ")} (have: ${Object.keys(sections).join(", ")})`);
    const steps = [
        ...(recipe.setup ?? []),
        ...Object.entries(sections)
            .filter(([k]) => !only || only.includes(k))
            .flatMap(([, s]) => s),
    ];
    const bad = steps.findIndex((s) => !Array.isArray(s) || typeof s[0] !== "string");
    if (bad >= 0) throw new Error(`step ${bad + 1} is not [cmd, ...args]: ${JSON.stringify(steps[bad])}`);
    return steps;
}

async function loadRecipe(file, ctx) {
    const abs = resolve(file);
    delete require.cache[abs];
    const mod = require(abs);
    const fn = typeof mod === "function" ? mod : mod.default;
    if (typeof fn !== "function") throw new Error(`${file} must export (ctx) => ({ setup, sections })`);
    return fn(ctx);
}
