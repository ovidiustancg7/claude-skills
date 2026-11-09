// A tiny app for the end-to-end test: a server-rendered login form in front of an SPA with a
// history router and two API endpoints. Port from PORT (default 8765).
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8765);
const ORIGIN = `http://127.0.0.1:${PORT}`;

const loginPage = `<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title>
<style>body{font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f6f6f4}form{display:grid;gap:10px;width:280px}</style></head>
<body><form method="post" action="/login"><h1>Sign in</h1>
<input type="email" name="email" placeholder="Email"><input type="password" name="password" placeholder="Password">
<button type="submit">Sign in</button></form></body></html>`;

const spa = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fixture</title>
<style>body{font:16px system-ui;margin:0}nav{display:flex;gap:16px;padding:16px;background:#14140f;color:#fff}main{padding:24px}
.tile{display:inline-block;padding:16px 20px;border:1px solid #ddd;border-radius:10px;margin:0 12px 12px 0}
li{padding:8px 0;border-bottom:1px solid #eee}</style></head>
<body><div id="app"></div><script>
const app = document.getElementById('app');
const routes = {
  '/': async () => {
    const s = await (await fetch('/api/stats')).json();
    const x = await (await fetch('/api/external')).json();
    return '<h1>Dashboard</h1><div class="tile" id="orders">Orders today: ' + s.orders + '</div>'
      + '<div class="tile" id="share">' + s.share + '</div><div class="tile" id="external">' + x.label + '</div>';
  },
  '/orders': async () => '<h1>Orders</h1><ul>' + Array.from({ length: 40 }, (_, i) => '<li>Order #' + (1001 + i) + '</li>').join('') + '</ul>',
};
async function render() {
  const view = routes[location.pathname] ?? (async () => '<h1>Not found</h1>');
  app.innerHTML = '<nav><b>Fixture</b><span>' + location.pathname + '</span></nav><main>' + await view() + '</main>';
}
addEventListener('popstate', render);
setTimeout(render, 300); // mounts late, like a real SPA
</script></body></html>`;

const signedIn = (req) => /(?:^|;\s*)sid=demo(?:;|$)/.test(req.headers.cookie ?? "");
const send = (res, status, type, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": type, ...headers });
    res.end(body);
};

createServer((req, res) => {
    const path = new URL(req.url, ORIGIN).pathname;
    if (path === "/login" && req.method === "POST") {
        return send(res, 302, "text/plain", "", { "Set-Cookie": "sid=demo; Path=/; HttpOnly", Location: "/" });
    }
    if (path === "/login") return send(res, 200, "text/html", loginPage);
    if (path === "/api/stats") {
        if (!signedIn(req)) return send(res, 401, "application/json", '{"message":"Unauthenticated"}');
        return send(res, 200, "application/json", JSON.stringify({ orders: 12, share: `${ORIGIN}/share/abc` }));
    }
    // Stands for a system the local machine cannot reach (an ERP, a payment provider).
    if (path === "/api/external") return send(res, 502, "application/json", '{"label":"unreachable"}');
    if (!signedIn(req)) return send(res, 302, "text/plain", "", { Location: "/login" });
    return send(res, 200, "text/html", spa);
}).listen(PORT, "127.0.0.1", () => console.log(`fixture on ${ORIGIN}`));
