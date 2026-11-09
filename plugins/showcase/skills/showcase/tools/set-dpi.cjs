// Marks PNGs as N dpi (pHYs chunk, default 192). A 2x render at 192 dpi pastes into Outlook,
// Word and PowerPoint at HALF its pixel size: crisp on retina, normal size on the page
// (a 2560 px slide card = exactly a 13.33" widescreen slide). Gmail ignores it (fits width).
//   node set-dpi.cjs <file.png>... [--dpi 192]
const fs = require("fs");
const zlib = require("zlib");

function setDpi(file, dpi = 192) {
    const png = fs.readFileSync(file);
    const pxPerMetre = Math.round(dpi / 0.0254);
    const chunks = [];
    let at = 8;
    while (at < png.length) {
        const len = png.readUInt32BE(at);
        const type = png.toString("latin1", at + 4, at + 8);
        const end = at + 12 + len;
        if (type !== "pHYs") chunks.push({ type, buf: png.subarray(at, end) });
        at = end;
    }
    const data = Buffer.alloc(9);
    data.writeUInt32BE(pxPerMetre, 0);
    data.writeUInt32BE(pxPerMetre, 4);
    data[8] = 1; // unit: metre
    const body = Buffer.concat([Buffer.from("pHYs", "latin1"), data]);
    const phys = Buffer.alloc(12 + 9);
    phys.writeUInt32BE(9, 0);
    body.copy(phys, 4);
    phys.writeUInt32BE(zlib.crc32(body) >>> 0, 4 + body.length);
    const out = [png.subarray(0, 8)];
    for (const c of chunks) {
        out.push(c.buf);
        if (c.type === "IHDR") out.push(phys);
    }
    fs.writeFileSync(file, Buffer.concat(out));
}

/** [width, height] in pixels, from the IHDR chunk. */
const pngSize = (file) => {
    const head = Buffer.alloc(24);
    const fd = fs.openSync(file, "r");
    fs.readSync(fd, head, 0, 24, 0);
    fs.closeSync(fd);
    return [head.readUInt32BE(16), head.readUInt32BE(20)];
};

module.exports = { setDpi, pngSize };

if (require.main === module) {
    const args = process.argv.slice(2);
    const i = args.indexOf("--dpi");
    const dpi = i >= 0 ? Number(args.splice(i, 2)[1]) : 192;
    for (const f of args) {
        setDpi(f, dpi);
        console.log(`${dpi} dpi`, f);
    }
}
