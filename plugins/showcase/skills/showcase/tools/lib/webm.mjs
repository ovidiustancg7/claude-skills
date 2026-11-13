// A minimal WebM (Matroska) writer for one video track: enough for editors and browsers to
// open, seek and know the duration. Frames come from WebCodecs' VideoEncoder (VP9 or VP8).
//
// Layout: EBML header, then a Segment of known size holding Info (with Duration), Tracks,
// one Cluster per keyframe, and Cues pointing at every Cluster.

const MS = 1_000_000; // TimecodeScale: 1 ms per tick

/** EBML variable-size integer for an element's data size (always 8 bytes: simple and valid). */
const size8 = (n) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt(n));
    b[0] |= 0x01; // 8-byte length marker
    return b;
};
const idBytes = (id) => Buffer.from(id.toString(16).padStart(id > 0xffffff ? 8 : id > 0xffff ? 6 : id > 0xff ? 4 : 2, "0"), "hex");

export const el = (id, payload) => Buffer.concat([idBytes(id), size8(payload.length), payload]);
export const uint = (id, n) => {
    let hex = BigInt(n).toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    return el(id, Buffer.from(hex, "hex"));
};
const str = (id, s) => el(id, Buffer.from(s, "utf8"));
const f64 = (id, x) => {
    const b = Buffer.alloc(8);
    b.writeDoubleBE(x);
    return el(id, b);
};

export const ID = {
    EBML: 0x1a45dfa3,
    Segment: 0x18538067,
    Info: 0x1549a966,
    Tracks: 0x1654ae6b,
    TrackEntry: 0xae,
    Video: 0xe0,
    Cluster: 0x1f43b675,
    Timecode: 0xe7,
    SimpleBlock: 0xa3,
    Cues: 0x1c53bb6b,
    CuePoint: 0xbb,
    CueTime: 0xb3,
    CueTrackPositions: 0xb7,
    CueTrack: 0xf7,
    CueClusterPosition: 0xf1,
    Duration: 0x4489,
    PixelWidth: 0xb0,
    PixelHeight: 0xba,
    CodecID: 0x86,
};

/**
 * frames: [{ data: Buffer, ms: number, key: boolean }] in presentation order.
 * codec: "V_VP9" or "V_VP8". Returns the whole file as one Buffer.
 */
export function webm({ width, height, fps, codec = "V_VP9", frames, app = "showcase" }) {
    if (!frames.length) throw new Error("webm: no frames");
    if (!frames[0].key) throw new Error("webm: the first frame must be a keyframe");
    const frameMs = 1000 / fps;
    const durationMs = frames.at(-1).ms + frameMs;

    const header = el(
        ID.EBML,
        Buffer.concat([
            uint(0x4286, 1), // EBMLVersion
            uint(0x42f7, 1), // EBMLReadVersion
            uint(0x42f2, 4), // EBMLMaxIDLength
            uint(0x42f3, 8), // EBMLMaxSizeLength
            str(0x4282, "webm"), // DocType
            uint(0x4287, 4), // DocTypeVersion
            uint(0x4285, 2), // DocTypeReadVersion
        ]),
    );
    const info = el(
        ID.Info,
        Buffer.concat([uint(0x2ad7b1, MS), str(0x4d80, app), str(0x5741, app), f64(ID.Duration, durationMs)]),
    );
    const tracks = el(
        ID.Tracks,
        el(
            ID.TrackEntry,
            Buffer.concat([
                uint(0xd7, 1), // TrackNumber
                uint(0x73c5, 1), // TrackUID
                uint(0x83, 1), // TrackType: video
                uint(0x9c, 0), // FlagLacing
                str(ID.CodecID, codec),
                uint(0x23e383, Math.round(frameMs * 1e6)), // DefaultDuration, ns
                el(ID.Video, Buffer.concat([uint(ID.PixelWidth, width), uint(ID.PixelHeight, height)])),
            ]),
        ),
    );

    // A Cluster starts at every keyframe; block timecodes are int16 relative to it.
    const groups = [];
    for (const f of frames) {
        if (f.key || !groups.length) groups.push({ start: Math.round(f.ms), frames: [] });
        const g = groups.at(-1);
        const rel = Math.round(f.ms) - g.start;
        if (rel > 32767) throw new Error("webm: more than 32 s between keyframes");
        g.frames.push({ ...f, rel });
    }
    const clusters = groups.map((g) =>
        el(
            ID.Cluster,
            Buffer.concat([
                uint(ID.Timecode, g.start),
                ...g.frames.map((f) => {
                    const head = Buffer.alloc(4);
                    head[0] = 0x81; // track 1, as a 1-byte vint
                    head.writeInt16BE(f.rel, 1);
                    head[3] = f.key ? 0x80 : 0x00;
                    return el(ID.SimpleBlock, Buffer.concat([head, f.data]));
                }),
            ]),
        ),
    );

    // Cue positions are relative to the start of the Segment's data.
    let pos = info.length + tracks.length;
    const cuePoints = groups.map((g, i) => {
        const at = pos;
        pos += clusters[i].length;
        return el(
            ID.CuePoint,
            Buffer.concat([
                uint(ID.CueTime, g.start),
                el(ID.CueTrackPositions, Buffer.concat([uint(ID.CueTrack, 1), uint(ID.CueClusterPosition, at)])),
            ]),
        );
    });
    const cues = el(ID.Cues, Buffer.concat(cuePoints));
    return Buffer.concat([header, el(ID.Segment, Buffer.concat([info, tracks, ...clusters, cues]))]);
}

/** Reads the top-level structure back (for tests): [{ id, start, size, dataStart }]. */
export function readElements(buf, from = 0, to = buf.length) {
    const out = [];
    let i = from;
    while (i < to) {
        const first = buf[i];
        const idLen = first & 0x80 ? 1 : first & 0x40 ? 2 : first & 0x20 ? 3 : 4;
        const id = buf.readUIntBE(i, idLen);
        const s0 = buf[i + idLen];
        let sizeLen = 1;
        while (sizeLen <= 8 && !(s0 & (0x80 >> (sizeLen - 1)))) sizeLen++;
        let size = BigInt(s0 & (0xff >> sizeLen));
        for (let k = 1; k < sizeLen; k++) size = (size << 8n) | BigInt(buf[i + idLen + k]);
        const dataStart = i + idLen + sizeLen;
        out.push({ id, start: i, size: Number(size), dataStart });
        i = dataStart + Number(size);
    }
    return out;
}
