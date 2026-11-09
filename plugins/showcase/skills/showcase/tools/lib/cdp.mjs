// A minimal Chrome DevTools Protocol client over Node's built-in WebSocket (Node 22+).
// No Puppeteer: nothing to install, and it drives the one Chrome `dev.mjs up` started.

export async function connectPage(port) {
    let list;
    try {
        list = await (await fetch(`http://localhost:${port}/json`)).json();
    } catch {
        throw new Error(`no Chrome answers on :${port}: run \`node dev.mjs up\` first`);
    }
    let page = list.find((t) => t.type === "page");
    if (!page) page = await (await fetch(`http://localhost:${port}/json/new?about:blank`, { method: "PUT" })).json();
    return connect(page.webSocketDebuggerUrl);
}

export async function connect(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, fail) => {
        ws.addEventListener("open", ok, { once: true });
        ws.addEventListener("error", () => fail(new Error(`cannot open ${url}`)), { once: true });
    });
    let id = 0;
    const pending = new Map();
    const listeners = new Map();
    ws.addEventListener("message", (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        } else if (msg.method) {
            for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
        }
    });
    const send = (method, params = {}) =>
        new Promise((ok, fail) => {
            const n = ++id;
            pending.set(n, (msg) => (msg.error ? fail(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : ok(msg.result)));
            ws.send(JSON.stringify({ id: n, method, params }));
        });
    const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]);
    const evaluate = async (expression) => {
        const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) {
            throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] ?? r.exceptionDetails.text);
        }
        return r.result.value;
    };
    const close = () => ws.close();
    const closed = new Promise((r) => ws.addEventListener("close", r, { once: true }));
    return { send, on, evaluate, close, closed };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
