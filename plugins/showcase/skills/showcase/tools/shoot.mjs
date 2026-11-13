// Screenshots of the real app: drives the project's headless Chrome (dev.mjs up) over CDP.
//
//   node shoot.mjs <recipe.cjs> [--only a,b] [--out dir] [--kit name]   run a recipe
//   node shoot.mjs <recipe.cjs> --list                                    its section names
//   node shoot.mjs <steps.json>                                           a plain array of steps
//
// Paths in steps are relative to the project root (the folder holding .showcase/).
// The steps (go, nav, eval, wait, sleep, cookie, size, scrollbars, fit, shot, mock, rewrite,
// file, geo) are documented in lib/steps.mjs and reference/recipes.md.
import { resolve } from "node:path";
import { connectPage } from "./lib/cdp.mjs";
import { loadProject } from "./lib/project.mjs";
import { listSections, loadSteps } from "./lib/recipe.mjs";
import { createSteps, runAll } from "./lib/steps.mjs";

const file = process.argv[2];
if (!file || file.startsWith("--")) {
    console.error("usage: node shoot.mjs <recipe.cjs|steps.json> [--only a,b] [--out dir] [--kit name] [--list]");
    process.exit(2);
}
const recipeFile = resolve(file);
const project = loadProject();
const { root, config } = project;

if (process.argv.includes("--list")) {
    console.log((await listSections(recipeFile, project)).join("\n"));
    process.exit(0);
}

const steps = await loadSteps(recipeFile, project);
process.chdir(root);

const page = await connectPage(config.cdpPort);
const runner = createSteps(page, config);
let ok = false;
try {
    await runner.init();
    ok = await runAll(steps, runner.run);
} finally {
    if (runner.errors.length) console.log("page errors:", JSON.stringify(runner.errors));
    page.close();
}
process.exit(ok ? 0 : 1);
