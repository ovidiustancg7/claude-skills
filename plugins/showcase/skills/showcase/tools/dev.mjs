// Bring a shoot up and down in one command each.
//
//   node dev.mjs up [--no-app]   the project's servers (config "app"; only those not already
//                                answering: the user's own dev server is used as is), then the
//                                project's headless Chrome on its cdpPort; waits for all of them.
//   node dev.mjs down            closes that Chrome gracefully, stops ONLY the servers `up`
//                                started (each checked to still be that process), sweeps
//                                Chrome's temp leftovers (Windows).
//   node dev.mjs status          what answers right now.
//
// What `up` started is written to <work>/dev-state.json, so `down` never touches a server or
// a browser it did not start (beyond the project's own Chrome profile).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { close, commandLine, findChrome, launch, listeners, sweepTemp, usesProfile } from "./lib/chrome.mjs";
import { sleep } from "./lib/cdp.mjs";
import { loadProject } from "./lib/project.mjs";

const { root, config, abs } = loadProject();
const WORK = abs(config.work);
const STATE = join(WORK, "dev-state.json");
const LOGS = join(WORK, "logs");
const PROFILE = abs(config.chromeProfile);
const PORT = config.cdpPort;
const WIN = process.platform === "win32";

const readState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { apps: {} });
const answers = async (url) => {
    try {
        const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2000) });
        return r.status > 0 && r.status < 500; // a redirect to /login is "up"
    } catch {
        return false;
    }
};
const chromeAnswers = () => answers(`http://localhost:${PORT}/json/version`);
const appReady = async (app) => (app.file ? existsSync(abs(app.file)) : answers(app.url ?? config.baseUrl));
const norm = (s) => s.replace(/\\/g, "/").replace(/"/g, "").toLowerCase();

const cmd = process.argv[2];

if (cmd === "up") {
    mkdirSync(LOGS, { recursive: true });
    const state = readState();

    if (!process.argv.includes("--no-app")) {
        for (const app of config.app) {
            if (await appReady(app)) {
                console.log(`${app.name}: already running, using it`);
                continue;
            }
            const [file, ...args] = app.cmd;
            const log = openSync(join(LOGS, `${app.name}.log`), "w");
            const child = spawn(file === "node" ? process.execPath : file, args, {
                cwd: abs(app.cwd ?? "."),
                env: { ...process.env, ...app.env },
                detached: true,
                shell: Boolean(app.shell),
                stdio: ["ignore", log, log],
                windowsHide: true,
            });
            child.unref();
            state.apps[app.name] = { pid: child.pid, args, cleanup: app.cleanup ?? [] };
            console.log(`${app.name}: started (pid ${child.pid}), log ${join(LOGS, `${app.name}.log`)}`);
        }
    }

    if (await chromeAnswers()) {
        const foreign = listeners(PORT).filter((o) => !usesProfile(o.cmd, PROFILE));
        if (foreign.length) {
            console.error(
                `:${PORT} is taken by something that is not this project's Chrome, refusing to drive it:\n` +
                    foreign.map((o) => `  ${o.pid} ${o.cmd}`).join("\n") +
                    `\nPick another cdpPort in .showcase/config.json, or stop that process yourself.`,
            );
            process.exit(1);
        }
        console.log(`chrome: :${PORT} already answers on this project's profile, using it`);
    } else {
        state.chrome = launch({ chrome: findChrome(config.chrome), profile: PROFILE, port: PORT, log: join(LOGS, "chrome.log") });
        console.log(`chrome: started (pid ${state.chrome}) on :${PORT}, profile ${PROFILE}`);
    }
    writeFileSync(STATE, JSON.stringify(state, null, 2));

    const wanted = process.argv.includes("--no-app") ? [] : config.app;
    for (let i = 0; i < 120; i++) {
        const ready = await Promise.all([...wanted.map(appReady), chromeAnswers()]);
        if (ready.every(Boolean)) {
            console.log(`ready: ${[...wanted.map((a) => a.name), `chrome :${PORT}`].join(", ")}`);
            process.exit(0);
        }
        await sleep(1000);
    }
    const missing = (await Promise.all(wanted.map(async (a) => ((await appReady(a)) ? null : a.name)))).filter(Boolean);
    if (!(await chromeAnswers())) missing.push("chrome");
    console.error(
        `not ready after 120 s: ${missing.join(", ")}. Read the logs in ${LOGS}.` +
            (missing.includes("chrome")
                ? " A Chrome that exits at once (code 21) usually means its profile is in use or the sandbox blocks it: run outside the sandbox."
                : ""),
    );
    process.exit(1);
}

if (cmd === "down") {
    const state = readState();
    if (await chromeAnswers()) {
        const r = await close(PORT, PROFILE);
        console.log(r.closed ? "chrome: closed" : `chrome: NOT closed. ${r.reason}`);
    } else console.log("chrome: not running");

    for (const [name, { pid, args, cleanup }] of Object.entries(state.apps ?? {})) {
        const line = commandLine(pid);
        if (!line) {
            console.log(`${name}: already gone`);
        } else if (!args.every((a) => norm(line).includes(norm(a)))) {
            // The pid was reused by another process: never kill it.
            console.log(`${name}: pid ${pid} is now another process, left alone: ${line.slice(0, 140)}`);
            continue;
        } else {
            try {
                if (WIN) execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
                else process.kill(-pid, "SIGTERM");
                console.log(`${name}: stopped`);
            } catch {
                console.log(`${name}: could not be stopped (pid ${pid})`);
            }
        }
        for (const f of cleanup) {
            if (existsSync(abs(f))) {
                rmSync(abs(f), { force: true });
                console.log(`${name}: removed stale ${f}`);
            }
        }
    }

    const { swept, left } = sweepTemp();
    if (process.platform === "win32") console.log(`temp: swept ${swept} Chrome folder(s)${left.length ? `, ${left.length} still in use` : ""}`);
    rmSync(STATE, { force: true });
    rmSync(LOGS, { recursive: true, force: true });
    process.exit(0);
}

if (cmd === "status") {
    for (const app of config.app) console.log(`${app.name}: ${(await appReady(app)) ? "up" : "down"}`);
    const owners = (await chromeAnswers()) ? listeners(PORT) : [];
    console.log(
        `chrome :${PORT}: ${!owners.length ? "down" : owners.every((o) => usesProfile(o.cmd, PROFILE)) ? "up (this project's)" : "TAKEN by another process"}`,
    );
    console.log(`root: ${root}`);
    process.exit(0);
}

console.error("usage: node dev.mjs up [--no-app] | down | status");
process.exit(2);
