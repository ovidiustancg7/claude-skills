// Caption plates for OpenScreen (addEffect, target "image"): a kicker pill above a headline
// plate, drawn UNDER the text annotations, with a soft shadow, an eased rise in and a fade
// out. `dim` darkens the picture behind them (intro and outro titles). One frame read: the
// "light" tier, fine over a whole video.
//
// Params (declare them with the effect, see reference/video.md):
//   head_c (point), head_w, head_h (numbers, 0..1 of the frame): the headline annotation's
//     box as getCurrentDocument reports it (x/100, y/100, width/100, height/100)
//   kick_c, kick_w, kick_h: the kicker's box; kick_w = 0 draws no kicker
//   head_col, kick_col (colors): plate colours
//   dim (number, 0..0.85): how much the picture behind darkens
// The plates add their own padding around the boxes.

fn sd_box(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + vec2<f32>(r);
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn ease_out(t: f32) -> f32 {
    let u = 1.0 - clamp(t, 0.0, 1.0);
    return 1.0 - u * u * u;
}

// 1 while the region shows, easing in over 0.38 s after `delay` and out over its last 0.25 s.
fn presence(delay: f32) -> f32 {
    let tin = ease_out((ctx.region.z - delay) / 0.38);
    let tout = clamp((ctx.region.y - ctx.region.z) / 0.25, 0.0, 1.0);
    return tin * tout;
}

fn plate(col: vec3<f32>, uv: vec2<f32>, c: vec2<f32>, w: f32, h: f32, pad: vec2<f32>, radius: f32, tint: vec3<f32>, delay: f32) -> vec3<f32> {
    if (w <= 0.0) { return col; }
    let tin = ease_out((ctx.region.z - delay) / 0.38);
    let a = presence(delay);
    if (a <= 0.0) { return col; }
    let rise = fx_px(26.0) * (1.0 - tin);
    let sc = mix(0.9, 1.0, tin);
    let m = vec2<f32>(ctx.aspect, 1.0);
    let p = (uv - c - vec2<f32>(0.0, rise)) * m;
    let half = (vec2<f32>(w * ctx.aspect, h) * 0.5 + pad) * sc;
    let r = min(radius, half.y);
    let d = sd_box(p, half, r);
    let ds = sd_box(p - vec2<f32>(0.0, fx_px(10.0)), half, r);
    let sh = (1.0 - smoothstep(-fx_px(4.0), fx_px(34.0), ds)) * 0.45 * a;
    var out = mix(col, vec3<f32>(0.0), sh);
    let aa = fx_px(1.2);
    let fill = (1.0 - smoothstep(-aa, aa, d)) * a;
    return mix(out, tint, fill);
}

fn effect(uv: vec2<f32>) -> vec4<f32> {
    let src = frame(uv);
    var col = mix(src.rgb, vec3<f32>(0.0), params.dim * presence(0.0));
    col = plate(col, uv, params.kick_c, params.kick_w, params.kick_h, vec2<f32>(fx_px(18.0), fx_px(8.0)), fx_px(40.0), params.kick_col.rgb, 0.0);
    col = plate(col, uv, params.head_c, params.head_w, params.head_h, vec2<f32>(fx_px(24.0), fx_px(14.0)), fx_px(24.0), params.head_col.rgb, 0.08);
    return vec4<f32>(col, src.a);
}
