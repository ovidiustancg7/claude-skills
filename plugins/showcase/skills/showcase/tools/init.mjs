// Scaffold .showcase/ in a project: config, notes, an example recipe and cards spec, the
// demo-kit folder. Never overwrites a file that exists.
//
//   node init.mjs [--root dir] [--port 9450] [--name "App name"]
//
// It guesses how the app starts from the files it sees (Laravel, Vite, Next, Django, Rails,
// plain PHP, WordPress) and prints what it guessed: review .showcase/config.json afterwards.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flag } from "./lib/project.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(flag("--root") ?? process.cwd());
const has = (f) => existsSync(join(root, f));
const pkg = has("package.json") ? JSON.parse(readFileSync(join(root, "package.json"), "utf8")) : {};
const deps = { ...pkg.dependencies, ...pkg.devDependencies };

function guess() {
    if (has("artisan")) {
        const app = [
            {
                name: "serve",
                url: "http://127.0.0.1:8000/",
                // PHP's own server, as `artisan serve` runs it underneath: the artisan wrapper
                // supervises a child and can die at once when started detached.
                cmd: ["php", "-S", "127.0.0.1:8000", "../vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php"],
                cwd: "public",
            },
        ];
        if (deps.vite) app.push({ name: "vite", file: "public/hot", cmd: ["node", "node_modules/vite/bin/vite.js"], cleanup: ["public/hot"] });
        return { stack: `Laravel${deps.vite ? " + Vite" : ""}`, baseUrl: "http://127.0.0.1:8000", app };
    }
    if (has("wp-config.php") || has("wp-content") || has("style.css") && readFileSync(join(root, "style.css"), "utf8").includes("Theme Name:")) {
        return { stack: "WordPress (start it your usual way, then set baseUrl; app left empty)", baseUrl: "http://localhost:8080", app: [] };
    }
    if (has("manage.py")) {
        return {
            stack: "Django",
            baseUrl: "http://127.0.0.1:8000",
            app: [{ name: "django", url: "http://127.0.0.1:8000/", cmd: ["python", "manage.py", "runserver", "127.0.0.1:8000", "--noreload"] }],
        };
    }
    if (has("bin/rails")) {
        return { stack: "Rails", baseUrl: "http://127.0.0.1:3000", app: [{ name: "rails", url: "http://127.0.0.1:3000/", cmd: ["ruby", "bin/rails", "server", "-b", "127.0.0.1", "-p", "3000"] }] };
    }
    if (deps.next) {
        return { stack: "Next.js", baseUrl: "http://localhost:3000", app: [{ name: "next", url: "http://localhost:3000/", cmd: ["npm", "run", "dev"], shell: true }] };
    }
    if (pkg.scripts?.dev && deps.vite) {
        return { stack: "Vite", baseUrl: "http://localhost:5173", app: [{ name: "vite", url: "http://localhost:5173/", cmd: ["npm", "run", "dev"], shell: true }] };
    }
    if (has("index.php")) {
        const router = has("router.php") ? ["router.php"] : [];
        return {
            stack: `plain PHP${router.length ? " (router.php)" : ""}`,
            baseUrl: "http://127.0.0.1:8000",
            app: [{ name: "php", url: "http://127.0.0.1:8000/", cmd: ["php", "-S", "127.0.0.1:8000", ...router] }],
        };
    }
    return { stack: "unknown (fill in baseUrl and app by hand)", baseUrl: "http://127.0.0.1:8000", app: [] };
}

const free = (port) =>
    new Promise((ok) => {
        const s = createServer();
        s.once("error", () => ok(false));
        s.listen(port, "127.0.0.1", () => s.close(() => ok(true)));
    });
async function pickPort() {
    if (flag("--port")) return Number(flag("--port"));
    for (let p = 9450; p < 9500; p++) if (await free(p)) return p;
    throw new Error("no free port in 9450–9499: pass --port");
}

const dir = join(root, ".showcase");
const g = guess();
const config = {
    name: flag("--name") ?? pkg.name ?? basename(root),
    baseUrl: g.baseUrl,
    cdpPort: await pickPort(),
    lang: "en",
    app: g.app,
    kits: { demo: { default: true, dir: ".showcase/.work/demo", setup: "<the command that plants the demo kit>", clean: "<the command that removes it>" } },
};

const written = [];
const write = (rel, content) => {
    const f = join(dir, rel);
    if (existsSync(f)) return console.log(`kept      .showcase/${rel} (exists)`);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, content);
    written.push(rel);
    console.log(`created   .showcase/${rel}`);
};
write("config.json", `${JSON.stringify(config, null, 4)}\n`);
write(".gitignore", ".work/\nout/\n");
for (const t of ["README.md", "recipes/example.cjs", "recipes/example.cards.cjs", "demo/README.md"]) {
    const src = join(here, "../templates", t);
    write(t, readFileSync(src, "utf8").replaceAll("{{name}}", config.name));
}
console.log(`\nstack:    ${g.stack}\nbaseUrl:  ${config.baseUrl}\ncdpPort:  ${config.cdpPort}\nReview .showcase/config.json, then build the demo kit (see reference/project-setup.md).`);
