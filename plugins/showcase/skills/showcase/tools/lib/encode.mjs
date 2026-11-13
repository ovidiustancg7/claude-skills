// Frames (JPEG files) → a WebM, encoded by Chrome's own WebCodecs: no ffmpeg, nothing to
// install. A throwaway local server hands the frames to a page in the project's Chrome
// (WebCodecs needs a secure context: http://127.0.0.1 is one, a data: URL is not), the page
// encodes them and posts the chunks back, and webm.mjs writes the file.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "./cdp.mjs";
import { webm } from "./webm.mjs";

const PAGE = `<!doctype html><meta charset="utf-8"><title>showcase encoder</title><script>
async function encode({ count, fps, width, height, bitrate, keyEvery }) {
  let codec = null;
  for (const c of ["vp09.00.50.08", "vp8"]) {
    const s = await VideoEncoder.isConfigSupported({ codec: c, width, height, bitrate, framerate: fps });
    if (s.supported) { codec = c; break; }
  }
  if (!codec) throw new Error("this Chrome cannot encode VP9 or VP8 at " + width + "x" + height);
  let failed = null;
  const posts = [];
  const enc = new VideoEncoder({
    output: (chunk) => {
      const b = new Uint8Array(chunk.byteLength);
      chunk.copyTo(b);
      posts.push(fetch("/chunk?ts=" + chunk.timestamp + "&key=" + (chunk.type === "key" ? 1 : 0), { method: "POST", body: b }));
    },
    error: (e) => { failed = e; },
  });
  enc.configure({ codec, width, height, bitrate, framerate: fps, latencyMode: "quality" });
  for (let i = 0; i < count; i++) {
    if (failed) throw failed;
    const bmp = await createImageBitmap(await (await fetch("/f/" + i)).blob());
    if (bmp.width !== width || bmp.height !== height) throw new Error("frame " + i + " is " + bmp.width + "x" + bmp.height);
    const vf = new VideoFrame(bmp, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(vf, { keyFrame: i % keyEvery === 0 });
    vf.close();
    bmp.close();
    while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
  }
  await enc.flush();
  await Promise.all(posts);
  if (failed) throw failed;
  return codec;
}
</script>`;

/**
 * Encodes frames/<i>.jpg (i = 0..count-1) into a WebM Buffer, in the Chrome on `port`.
 * Returns { buffer, codec }.
 */
export async function encodeFrames({ port, framesDir, count, fps, width, height, bitrate = 14e6, log = () => {} }) {
    const chunks = [];
    const server = createServer((req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        if (url.pathname === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
        const f = url.pathname.match(/^\/f\/(\d+)$/);
        if (f) {
            try {
                return res.writeHead(200, { "content-type": "image/jpeg" }).end(readFileSync(join(framesDir, frameName(Number(f[1])))));
            } catch {
                return res.writeHead(404).end();
            }
        }
        if (url.pathname === "/chunk" && req.method === "POST") {
            const parts = [];
            req.on("data", (d) => parts.push(d));
            req.on("end", () => {
                chunks.push({ data: Buffer.concat(parts), ms: Number(url.searchParams.get("ts")) / 1000, key: url.searchParams.get("key") === "1" });
                res.writeHead(204).end();
            });
            return;
        }
        res.writeHead(404).end();
    });
    await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
    const origin = `http://127.0.0.1:${server.address().port}/`;

    let target;
    let page;
    try {
        target = await (await fetch(`http://localhost:${port}/json/new?${encodeURIComponent(origin)}`, { method: "PUT" })).json();
        page = await connect(target.webSocketDebuggerUrl);
        await page.send("Runtime.enable");
        for (let i = 0; i < 40 && !(await page.evaluate("typeof encode === 'function'").catch(() => false)); i++) {
            await new Promise((r) => setTimeout(r, 100));
        }
        const t0 = Date.now();
        const codec = await page.evaluate(`encode(${JSON.stringify({ count, fps, width, height, bitrate, keyEvery: fps * 2 })})`);
        log(`encoded ${count} frames (${codec}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        chunks.sort((a, b) => a.ms - b.ms);
        const buffer = webm({ width, height, fps, codec: codec.startsWith("vp09") ? "V_VP9" : "V_VP8", frames: chunks });
        return { buffer, codec };
    } finally {
        page?.close();
        if (target) await fetch(`http://localhost:${port}/json/close/${target.id}`).catch(() => {});
        server.close();
    }
}

export const frameName = (i) => `${String(i).padStart(6, "0")}.jpg`;
