// The steps a recipe is made of, run in the project's Chrome. Shared by shoot.mjs (stills)
// and record.mjs (video), so a video's off-camera setup reads like any recipe.
//
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
import { sleep } from "./cdp.mjs";

// CDP url patterns treat * and ? as wildcards and \ as the escape.
const glob = (s) => `*${s.replace(/[\\*?]/g, (c) => `\\${c}`)}*`;

/** The JS that tells whether the page (and an SPA root, if any) has rendered. */
export const mountedJs = (mountSelector) =>
    `document.readyState === "complete" && (() => { const el = document.querySelector(${JSON.stringify(mountSelector)}); return !el || el.childElementCount > 0; })()`;

/** JS that pushes a client-side route; returns which router took it. */
export const navJs = (to, mountSelector) => `(() => {
    const to = ${JSON.stringify(to)};
    const el = document.querySelector(${JSON.stringify(mountSelector)});
    const v3 = el && el.__vue_app__;
    if (v3) { v3.config.globalProperties.$router.push(to); return "vue"; }
    const v2 = el && el.__vue__ && el.__vue__.$router;
    if (v2) { v2.push(to); return "vue2"; }
    if (window.next && window.next.router) { window.next.router.push(to); return "next"; }
    history.pushState({}, "", to); dispatchEvent(new PopStateEvent("popstate", { state: {} })); return "history";
})()`;

export function createSteps(page, config, log = console.log) {
    const { send, on, evaluate } = page;
    const mocks = [];
    const rewrites = [];
    const errors = [];
    const state = { size: { width: 1440, height: 900, dpr: null } };

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

    const dpr = () => state.size.dpr ?? (state.size.width <= 500 ? 3 : 2);
    const applySize = () =>
        send("Emulation.setDeviceMetricsOverride", {
            width: state.size.width,
            height: state.size.height,
            deviceScaleFactor: dpr(),
            mobile: state.size.width <= 500,
        });
    const absUrl = (u) => (u.startsWith("/") ? `${config.baseUrl}${u}` : u);

    async function init() {
        await send("Runtime.enable");
        await send("Page.enable");
        await applySize();
    }

    async function run(cmd, args) {
        switch (cmd) {
            case "sleep":
                return sleep(Number(args[0]));
            case "size":
                state.size = { width: Number(args[0]), height: Number(args[1]), dpr: args[2] ? Number(args[2]) : null };
                await applySize();
                return sleep(500);
            case "scrollbars":
                return send("Emulation.setScrollbarsHidden", { hidden: args[0] === "off" });
            case "fit":
                // Measured once: a taller viewport stretches min-height pages, so a second look grows forever.
                state.size = { ...state.size, height: await evaluate("document.documentElement.scrollHeight") };
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
                const how = await evaluate(navJs(args[0], config.mountSelector));
                await sleep(Number(args[1] ?? 3000));
                return log(`nav ${await evaluate("location.pathname + location.search")} (${how})`);
            }
            case "go": {
                await send("Page.navigate", { url: absUrl(args[0]) });
                // A cold dev server (Vite's first load) can take 10–20 s: wait for the document, and
                // for an SPA root to mount. Server-rendered pages have no such root and pass at once.
                for (let t = 0; t < 60; t++) {
                    await sleep(500);
                    if (await evaluate(mountedJs(config.mountSelector)).catch(() => false)) break;
                }
                await sleep(Number(args[1] ?? 4000));
                return log(`go ${await evaluate("location.pathname + location.search")}`);
            }
            case "eval":
                return log(JSON.stringify(await evaluate(args[0]), null, 2));
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
                    params.clip = { x: 0, y: 0, width: state.size.width, height: Math.min(m.docH, 5000), scale: 1 };
                }
                const { data } = await send("Page.captureScreenshot", params);
                mkdirSync(dirname(resolve(out)), { recursive: true });
                writeFileSync(out, Buffer.from(data, "base64"));
                return log(`saved ${out} ${JSON.stringify(m)}${m.scrollW > state.size.width ? " OVERFLOW (wider than the viewport)" : ""}`);
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

    return { init, run, errors, state, dpr, absUrl };
}

/** Runs steps in order; on a failure prints which step and returns false. */
export async function runAll(steps, run, label = "step") {
    for (const [n, [c, ...a]] of steps.entries()) {
        try {
            await run(c, a);
        } catch (e) {
            const shown = a.map((x) => (String(x).length > 60 ? `${String(x).slice(0, 57)}...` : x)).join(" ");
            console.error(`${label} ${n + 1}/${steps.length} failed: ${c} ${shown}\n  ${e.message}`);
            return false;
        }
    }
    return true;
}
