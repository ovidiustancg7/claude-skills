// Launch, identify and close the project's own headless Chrome. Every rule here closes a
// leak or an accident seen in practice:
//   - a FIXED, ABSOLUTE profile folder that exists: without --user-data-dir every launch
//     leaves a ~12 MB profile in the temp dir; a relative or missing one makes Chrome exit 21
//     silently or, worse, land on the user's REAL profile (with their logins);
//   - --disable-extensions: managed machines push extensions, which Chrome unpacks into a new
//     temp folder on every launch;
//   - closing goes through CDP Browser.close, and only after EVERY process listening on the
//     port is proven to be this project's Chrome. The user's own Chrome must never be closed
//     or killed. When 127.0.0.1:<port> is taken, Chrome quietly binds [::1]:<port> instead,
//     so one port can have two owners.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "./cdp.mjs";

const WIN = process.platform === "win32";
const MAC = process.platform === "darwin";

export function findChrome(configured) {
    const env = process.env;
    const candidates = [
        configured,
        env.SHOWCASE_CHROME,
        ...(WIN
            ? [
                  `${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
                  `${env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
                  `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
                  `${env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
                  `${env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
              ]
            : MAC
              ? [
                    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                    "/Applications/Chromium.app/Contents/MacOS/Chromium",
                    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                ]
              : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"].map(which)),
    ].filter(Boolean);
    const found = candidates.find((c) => existsSync(c));
    if (!found) throw new Error("Chrome not found: set \"chrome\" in .showcase/config.json or SHOWCASE_CHROME to its path");
    return found;
}

function which(bin) {
    try {
        return execFileSync("which", [bin], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
    } catch {
        return null;
    }
}

/** Starts a detached headless Chrome; returns its pid. `profile` must be absolute. */
export function launch({ chrome, profile, port, log }) {
    mkdirSync(profile, { recursive: true });
    const out = openSync(log, "w");
    const child = spawn(
        chrome,
        [
            "--headless=new",
            "--disable-gpu",
            "--disable-extensions",
            "--no-first-run",
            "--no-default-browser-check",
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${WIN ? profile.replace(/\//g, "\\") : profile}`,
            "about:blank",
        ],
        { detached: true, stdio: ["ignore", out, out], windowsHide: true },
    );
    child.unref();
    return child.pid;
}

/** Every process listening on the port: [{ pid, cmd }] (cmd "" when it cannot be read). */
export function listeners(port) {
    if (WIN) {
        const ps =
            `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ` +
            "Select-Object -ExpandProperty OwningProcess -Unique | " +
            '% { "$_ " + (Get-CimInstance Win32_Process -Filter "ProcessId=$_").CommandLine }; exit 0';
        return execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" })
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => ({ pid: Number(l.split(" ")[0]), cmd: l.slice(l.indexOf(" ") + 1) }));
    }
    let pids = [];
    try {
        pids = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" })
            .split("\n")
            .filter(Boolean)
            .map(Number);
    } catch {
        return []; // lsof exits 1 when nothing listens
    }
    return [...new Set(pids)].map((pid) => ({ pid, cmd: commandLine(pid) }));
}

export function commandLine(pid) {
    try {
        if (WIN) {
            return execFileSync(
                "powershell",
                ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
                { encoding: "utf8" },
            ).trim();
        }
        return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim();
    } catch {
        return "";
    }
}

const norm = (s) => s.replace(/\\/g, "/").replace(/"/g, "").toLowerCase();

/** True when the command line runs on exactly this profile folder. */
export function usesProfile(cmd, profile) {
    const c = norm(cmd);
    const p = `--user-data-dir=${norm(profile).replace(/\/+$/, "")}`;
    const at = c.indexOf(p);
    if (at < 0) return false;
    const next = c[at + p.length];
    return next === undefined || next === " " || next === "/";
}

/** A browser on the user's everyday profile: never close or kill it. */
export const isRealProfile = (cmd) =>
    /google\/chrome\/user data|microsoft\/edge\/user data|application support\/google\/chrome|\.config\/google-chrome|\.config\/chromium/.test(
        norm(cmd),
    ) || (/chrome|msedge|chromium/.test(norm(cmd)) && !/--user-data-dir=/.test(norm(cmd)));

/**
 * Graceful close of the project's Chrome. Returns { closed, reason }. Refuses when anything
 * on the port is not a Chrome on `profile`.
 */
export async function close(port, profile) {
    const owners = listeners(port);
    if (!owners.length) return { closed: false, reason: `nothing listens on :${port}` };
    const foreign = owners.filter((o) => !usesProfile(o.cmd, profile));
    if (foreign.length) {
        const list = foreign.map((o) => `  ${o.pid} ${o.cmd || "(command line unreadable)"}`).join("\n");
        const real = foreign.some((o) => isRealProfile(o.cmd));
        return {
            closed: false,
            reason: real
                ? `REFUSED: :${port} is held by a browser on the user's REAL profile. Stop and tell the user; do not kill it.\n${list}`
                : `refused: :${port} is held by a process that is not this project's Chrome, left alone:\n${list}`,
        };
    }
    // localhost, not 127.0.0.1: every listener is ours by now, and ours may only have [::1].
    const { webSocketDebuggerUrl } = await (await fetch(`http://localhost:${port}/json/version`)).json();
    const browser = await connect(webSocketDebuggerUrl);
    browser.send("Browser.close").catch(() => {});
    await Promise.race([browser.closed, new Promise((r) => setTimeout(r, 10000))]);
    return { closed: true, pids: owners.map((o) => o.pid) };
}

/**
 * Windows only: Chrome's temp leftovers older than 10 minutes (scoped_dir*, HeadlessChrome*,
 * …). Folders still in use refuse to delete, which is what keeps other sessions safe. On
 * macOS/Linux deleting would succeed even under a running Chrome, so nothing is swept there.
 */
export function sweepTemp() {
    if (!WIN) return { swept: 0, left: [] };
    const dir = tmpdir();
    const cutoff = Date.now() - 10 * 60 * 1000;
    const pattern = /^(cdp-|cdpprof-|scoped_dir|HeadlessChrome|.*-probe-chrome)/i;
    let swept = 0;
    const left = [];
    for (const name of readdirSync(dir)) {
        if (!pattern.test(name)) continue;
        const full = join(dir, name);
        try {
            const st = statSync(full);
            if (!st.isDirectory() || st.mtimeMs > cutoff) continue;
            rmSync(full, { recursive: true, force: true, maxRetries: 0 });
            if (existsSync(full)) left.push(full);
            else swept++;
        } catch {
            left.push(full);
        }
    }
    return { swept, left };
}
