// Screenshots of the real app: drives the project's headless Chrome (dev.mjs up) over CDP.
//
//   node shoot.mjs <recipe.cjs> [--only a,b] [--out dir] [--kit name]   run a recipe
//   node shoot.mjs <recipe.cjs> --list                                    its section names
//   node shoot.mjs <steps.json>                                           a plain array of steps
//
// Paths in steps are relative to the project root (the folder holding .showcase/).
// Steps, each [cmd, ...args]:
//   go <url> [ms]            navigate (a "/path" is joined to baseUrl); waits for the page,
//                            and for an SPA root (mountSelector) to get children, then ms (4000)
//   nav <route> [ms]         client-side navigation (Vue Router 3/4, Next, else pushState +
//                            popstate), then ms (3000). Server-rendered apps: use go
//   eval <js>                run JS in the page (awaited); the result is printed
//   wait <js> [ms]           poll until the JS is truthy (timeout ms, default 15000)
//   sleep <ms>
//   cookie <name> <value> [url]   set a cookie (httpOnly allowed) for baseUrl or url
//   size <w> <h> [dpr]       viewport; dpr defaults to 3 for <=500 px wide (phone), else 2
//   scrollbars off|on        hide the page's scrollbars (cards always do; a headless Chrome
//                            can keep painting one after the viewport grew past the content)
//   fit                      viewport height = page height (measured once), for whole-page shots
//                            where fixed parts (a sidebar) must span the page
//   shot <file> [full]       PNG of the viewport, or the whole document (capped at 5000 css px)
//   mock <urlPart> <file.json> [status]   answer the page's XHR/fetch calls whose URL contains
//                                         urlPart with that file (documents are never mocked)
//   rewrite <urlPart> <from> <to>         replace text in matching real responses
//   file <selector> <path>   put a file into an <input type=file>
//   geo <lat> <lng>          grant geolocation and pin the position
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { connectPage, sleep } from "./lib/cdp.mjs";
import { loadProject } from "./lib/project.mjs";
import { listSections, loadSteps } from "./lib/recipe.mjs";

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
const { send, on, evaluate } = page;
const mocks = [];
const rewrites = [];
const errors = [];
let size = { width: 1440, height: 900, dpr: null };

on("Fetch.requestPaused", async (p) => {
    try {
        if (p.responseStatusCode !== undefined) {
            const rw = rewrites.find((x) => p.request.url.includes(x.match));
            if (!rw) return send("Fetch.continueRequest", { requestId: p.requestId });
            const { body, base64Encoded } = await send("Fetch.getResponseBody", { requestId: p.requestId });
            const text = (base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body).split(rw.from).join(rw.to);
            return send("Fetch.fulfillRequest", {
                requestId: p.requestId,
                responseCode: p.responseStatusCode,
                responseHeaders: p.responseHeaders.filter((h) => h.name.toLowerCase() !== "content-length"),
                body: Buffer.from(text).toString("base64"),
            });
        }
        const hit = mocks.find((x) => p.request.url.includes(x.match));
        if (!hit) return send("Fetch.continueRequest", { requestId: p.requestId });
        return send("Fetch.fulfillRequest", {
            requestId: p.requestId,
            responseCode: hit.status,
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            body: readFileSync(hit.file).toString("base64"),
        });
    } catch (e) {
        errors.push(`intercept ${p.request.url}: ${e.message}`);
    }
});
on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails.exception?.description?.split("\n")[0] ?? p.exceptionDetails.text));

const applySize = () =>
    send("Emulation.setDeviceMetricsOverride", {
        width: size.width,
        height: size.height,
        deviceScaleFactor: size.dpr ?? (size.width <= 500 ? 3 : 2),
        mobile: size.width <= 500,
    });
// CDP url patterns treat * and ? as wildcards and \ as the escape.
const glob = (s) => `*${s.replace(/[\\*?]/g, (c) => `\\${c}`)}*`;
const absUrl = (u) => (u.startsWith("/") ? `${config.baseUrl}${u}` : u);

await send("Runtime.enable");
await send("Page.enable");
await applySize();
let failed = false;
try {
    for (const [n, [c, ...a]] of steps.entries()) {
        try {
            await run(c, a);
        } catch (e) {
            const shown = a.map((x) => (String(x).length > 60 ? `${String(x).slice(0, 57)}...` : x)).join(" ");
            console.error(`step ${n + 1}/${steps.length} failed: ${c} ${shown}\n  ${e.message}`);
            failed = true;
            break;
        }
    }
} finally {
    if (errors.length) console.log("page errors:", JSON.stringify(errors));
    page.close();
}
process.exit(failed ? 1 : 0);

async function run(cmd, args) {
    switch (cmd) {
        case "sleep":
            return sleep(Number(args[0]));
        case "size":
            size = { width: Number(args[0]), height: Number(args[1]), dpr: args[2] ? Number(args[2]) : null };
            await applySize();
            return sleep(500);
        case "scrollbars":
            return send("Emulation.setScrollbarsHidden", { hidden: args[0] === "off" });
        case "fit":
            // Measured once: a taller viewport stretches min-height pages, so a second look grows forever.
            size = { ...size, height: await evaluate("document.documentElement.scrollHeight") };
            await applySize();
            return sleep(2000);
        case "mock":
        case "rewrite": {
            if (cmd === "mock") mocks.push({ match: args[0], file: resolve(args[1]), status: Number(args[2] ?? 200) });
            else rewrites.push({ match: args[0], from: args[1], to: args[2] });
            // Mocks answer the page's own API calls only: a page URL that happens to contain the
            // same text (/admin/jobs-calendar vs the /jobs-calendar endpoint) must still load.
            return send("Fetch.enable", {
                patterns: [
                    ...mocks.flatMap((m) =>
                        ["XHR", "Fetch"].map((resourceType) => ({ urlPattern: glob(m.match), resourceType, requestStage: "Request" })),
                    ),
                    ...rewrites.map((r) => ({ urlPattern: glob(r.match), requestStage: "Response" })),
                ],
            });
        }
        case "cookie":
            return send("Network.setCookie", { name: args[0], value: args[1], url: args[2] ?? `${config.baseUrl}/`, httpOnly: true });
        case "nav": {
            const how = await evaluate(`(() => {
                const to = ${JSON.stringify(args[0])};
                const el = document.querySelector(${JSON.stringify(config.mountSelector)});
                const v3 = el && el.__vue_app__;
                if (v3) { v3.config.globalProperties.$router.push(to); return "vue"; }
                const v2 = el && el.__vue__ && el.__vue__.$router;
                if (v2) { v2.push(to); return "vue2"; }
                if (window.next && window.next.router) { window.next.router.push(to); return "next"; }
                history.pushState({}, "", to); dispatchEvent(new PopStateEvent("popstate", { state: {} })); return "history";
            })()`);
            await sleep(Number(args[1] ?? 3000));
            return console.log(`nav ${await evaluate("location.pathname + location.search")} (${how})`);
        }
        case "go": {
            await send("Page.navigate", { url: absUrl(args[0]) });
            // A cold dev server (Vite's first load) can take 10–20 s: wait for the document, and
            // for an SPA root to mount. Server-rendered pages have no such root and pass at once.
            const mounted = `document.readyState === "complete" && (() => { const el = document.querySelector(${JSON.stringify(config.mountSelector)}); return !el || el.childElementCount > 0; })()`;
            for (let t = 0; t < 60; t++) {
                await sleep(500);
                if (await evaluate(mounted).catch(() => false)) break;
            }
            await sleep(Number(args[1] ?? 4000));
            return console.log(`go ${await evaluate("location.pathname + location.search")}`);
        }
        case "eval":
            return console.log(JSON.stringify(await evaluate(args[0]), null, 2));
        case "wait": {
            const until = Date.now() + Number(args[1] ?? 15000);
            while (Date.now() < until) {
                if (await evaluate(`!!(${args[0]})`).catch(() => false)) return;
                await sleep(250);
            }
            throw new Error("timed out waiting");
        }
        case "shot": {
            const [out, full] = args;
            await sleep(800);
            const m = await evaluate("({ scrollW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight })");
            const params = { format: "png" };
            if (full) {
                params.captureBeyondViewport = true;
                params.clip = { x: 0, y: 0, width: size.width, height: Math.min(m.docH, 5000), scale: 1 };
            }
            const { data } = await send("Page.captureScreenshot", params);
            mkdirSync(dirname(resolve(out)), { recursive: true });
            writeFileSync(out, Buffer.from(data, "base64"));
            return console.log(`saved ${out} ${JSON.stringify(m)}${m.scrollW > size.width ? " OVERFLOW (wider than the viewport)" : ""}`);
        }
        case "file": {
            const { root: doc } = await send("DOM.getDocument", { depth: -1 });
            const { nodeId } = await send("DOM.querySelector", { nodeId: doc.nodeId, selector: args[0] });
            if (!nodeId) throw new Error(`not found: ${args[0]}`);
            return send("DOM.setFileInputFiles", { nodeId, files: [resolve(args[1])] });
        }
        case "geo":
            await send("Browser.grantPermissions", { permissions: ["geolocation"], origin: new URL(config.baseUrl).origin });
            return send("Emulation.setGeolocationOverride", { latitude: Number(args[0]), longitude: Number(args[1]), accuracy: 15 });
        default:
            throw new Error(`unknown step "${cmd}"`);
    }
}
