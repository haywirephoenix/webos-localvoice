var ut = Object.defineProperty;
var et = Object.getOwnPropertySymbols;
var ht = Object.prototype.hasOwnProperty, dt = Object.prototype.propertyIsEnumerable;
var it = (n, t, e) => t in n ? ut(n, t, { enumerable: !0, configurable: !0, writable: !0, value: e }) : n[t] = e, w = (n, t) => {
  for (var e in t || (t = {}))
    ht.call(t, e) && it(n, e, t[e]);
  if (et)
    for (var e of et(t))
      dt.call(t, e) && it(n, e, t[e]);
  return n;
};
const nt = {
  ember: {
    light: {
      stops: ["#d92a0f", "#f7781f", "#ffd48c"],
      body: "#f4f0ee"
    },
    dark: {
      stops: ["#ff5a1f", "#ff9d3d", "#ffe0a8"],
      body: "#0a0708"
    }
  },
  iris: {
    light: {
      stops: ["#fa9ec7", "#dbbcf2", "#8ac9fa"],
      body: "#f6f4f7"
    },
    dark: {
      stops: ["#2a85f5", "#59d4fc", "#9e6bfa"],
      body: "#07080e"
    }
  },
  moss: {
    light: {
      stops: ["#1f8f6b", "#5cc79a", "#c9edd8"],
      body: "#eef3f0"
    },
    dark: {
      stops: ["#1fbd86", "#67e8b4", "#c2f5dd"],
      body: "#050b09"
    }
  },
  porcelain: {
    light: {
      stops: ["#b8c2cf", "#d9e0e8", "#f4f7fa"],
      body: "#f7f8fa"
    },
    dark: {
      stops: ["#6d7f96", "#a9bccf", "#e2ecf5"],
      body: "#080a0d"
    }
  },
  /**
   * Three deliberately unrelated hues. `vessel` maps one stop per inner body,
   * so a palette of near-neighbours collapses the lobes into a single mass —
   * this one keeps them readable as separate objects.
   */
  spectrum: {
    light: {
      stops: ["#2f8ff0", "#f0972a", "#8b5cf6"],
      body: "#f5f6f8"
    },
    dark: {
      stops: ["#3ba0ff", "#ffab3d", "#a077ff"],
      body: "#070910"
    }
  },
  /** Tuned for `plasma`: a cold discharge against deep blue gas. */
  discharge: {
    light: {
      stops: ["#2b3ecc", "#6f8dff", "#e6ecff"],
      body: "#eef0f7"
    },
    dark: {
      stops: ["#1b2fd6", "#7d97ff", "#f0f2ff"],
      body: "#04060f"
    }
  },
  /** The error state: an unmistakable red, kept apart from ember's orange. */
  crimson: {
    light: {
      stops: ["#b3121c", "#e5383b", "#ff8a80"],
      body: "#f6eeee"
    },
    dark: {
      stops: ["#d0161f", "#ff4538", "#ff9a8f"],
      body: "#0d0607"
    }
  }
}, st = "spectrum", mt = (
  /* glsl */
  `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`
), pt = (
  /* glsl */
  `
precision highp float;

varying vec2 vUv;

uniform float uTime;    // wall clock, for grain
uniform float uFlow;    // accumulated interior time, accelerated by output level
uniform float uRing;    // accumulated ring phase, advanced by input level
uniform int   uState;   // 0 idle · 1 listening · 2 thinking · 3 speaking
uniform float uDark;    // 0 light field, 1 dark field
uniform float uIn;      // 0-1 microphone level
uniform float uOut;     // body energy: state level + audio, 0-1.5
uniform float uGrain;
uniform float uSeed;
uniform float uDetail;  // 0 at avatar sizes, 1 at hero sizes
uniform vec3  uC1;
uniform vec3  uC2;
uniform vec3  uC3;
uniform vec3  uBody;
uniform float uBodyAlpha;   // 0 clear glass, 1 solid body colour between the bodies

// Outer ring: a radial band that rises from uRimInner and fades out from
// uRimFade to the edge of the glass (radius 1).
uniform vec3  uRimColor;
uniform float uRimInner;    // radius where the ring starts to rise
uniform float uRimFade;     // radius where it starts falling back to 0 at the edge
uniform float uRimStrength;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  // Output swells the orb, input contracts it very slightly. Budget is ±2% (P2).
  float grow = 1.0 + 0.020 * min(uOut, 1.0) - 0.008 * uIn;
  vec2 p = (vUv - 0.5) * 2.0 / grow;
  float r = length(p);

  float fl = uFlow + uSeed * 13.77;

  float bulge = sqrt(max(1.0 - min(dot(p, p), 1.0), 0.0));
  vec3 n = vec3(p, bulge);

  float alpha = 1.0 - smoothstep(0.982, 1.0, r);

  // ---- Contents: three bodies that drift and merge --------------------------
  vec3 acc = vec3(0.0);
  float field = 0.0;
  // Contents pressed against the glass read as attention; drawn to the centre
  // they read as idle. Output drives that ratio, which is the whole signal.
  float spread = 0.26 + 0.16 * uOut + 0.04 * sin(fl * 0.3);
  float mass = 0.150 + 0.055 * uOut;

  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float orbit = spread + 0.05 * sin(fl * 0.37 + fi * 1.7);
    vec2 c = vec2(cos(fl * 0.42 + fi * 2.094), sin(fl * 0.35 + fi * 2.094)) * orbit;
    float w = mass / (dot(p - c, p - c) + 0.034);
    vec3 lc = fi < 0.5 ? uC1 : (fi < 1.5 ? uC2 : uC3);
    field += w;
    acc += w * lc;
  }

  vec3 inner = acc / max(field, 0.0001);
  float body = smoothstep(0.80, 2.10, field) * 0.96;

  // Premultiplied: the coloured bodies sit over a ground of body colour whose
  // opacity is uBodyAlpha. At 1 this is the old opaque mix(uBody, inner, body);
  // lower lets the page show through between the bodies.
  float cover = body + (1.0 - body) * uBodyAlpha;
  vec3 base = inner * body + uBody * (1.0 - body) * uBodyAlpha;

  // Everything below is light added on top of the glass, not paint.
  vec3 glow = vec3(0.0);

  // ---- Shell: outer ring, edge sheen, one specular peak ---------------------
  float rim = smoothstep(uRimInner, 0.99, r) * smoothstep(1.0, uRimFade, r);
  glow += uRimColor * rim * uRimStrength;
  glow += vec3(1.0) * pow(1.0 - bulge, 8.0) * 0.14;

  vec3 L = normalize(vec3(-0.40, 0.60, 0.69));
  glow += vec3(1.0) * pow(max(dot(normalize(n), L), 0.0), 46.0) * 0.45;

  // ---- Thinking: an orbiting sweep, distinct in form from either voice (P8) --
  if (uState == 2) {
    float ang = atan(p.y, p.x);
    float sweep = 0.5 + 0.5 * cos(ang - fl * 1.5);
    glow += mix(uC2, uC3, 0.5) * pow(sweep, 7.0) * 0.40 * smoothstep(0.05, 0.85, r);
  }

  // ---- Input lives on the boundary, never in the body (P10) -----------------
  if (uIn > 0.004) {
    float pd = fract(r * 1.35 - uRing);
    float pulse = smoothstep(0.0, 0.30, pd) - smoothstep(0.30, 0.62, pd);
    vec3 pc = mix(uC3, vec3(0.42, 0.92, 0.99), 0.35 + 0.3 * uDark);
    glow += pc * pulse * uIn * 1.15 * smoothstep(0.10, 0.95, r);
    float rim2 = smoothstep(0.74, 0.995, r) * smoothstep(1.0, 0.90, r);
    glow += pc * rim2 * uIn * 1.5;
  }

  // ---- Grain: defeats banding and gives the eye something to resolve (P6) ---
  float g = hash21(vUv * 780.0 + fract(uTime) * 91.0);
  vec3 col = (base + glow) * (1.0 - uGrain * uDetail * (g - 0.5) * 2.0);
  col = clamp(col, 0.0, 1.0);

  // Alpha must cover the brightest channel to stay valid premultiplied colour,
  // so glow on clear glass reads as light rather than being dropped.
  float a = max(cover, max(col.r, max(col.g, col.b)));
  gl_FragColor = vec4(col * alpha, a * alpha);
}
`
), gt = {
  idle: 0,
  listening: 1,
  thinking: 2,
  speaking: 3,
  error: 4,
  noInput: 5
}, vt = [
  "uTime",
  "uFlow",
  "uRing",
  "uState",
  "uDark",
  "uIn",
  "uOut",
  "uGrain",
  "uSeed",
  "uDetail",
  "uC1",
  "uC2",
  "uC3",
  "uBody",
  "uBodyAlpha",
  "uRimColor",
  "uRimInner",
  "uRimFade",
  "uRimStrength"
], bt = 2, wt = 1.5, yt = ["#c8141e", "#ff3b30", "#ff8a80"];
function Tt(n, t = -60) {
  return O((n - t) / -t);
}
const At = {
  light: { color: "#8cc2f0", inner: 0.72, fade: 0.88, strength: 0.26, inputCap: 1 },
  dark: { color: "#85d6ff", inner: 0.72, fade: 0.88, strength: 0.64, inputCap: 1 }
}, P = /* @__PURE__ */ new Map();
function T(n) {
  let t = P.get(n);
  return t || (t = Lt(n), P.size > 256 && P.clear(), P.set(n, t)), t;
}
function Lt(n) {
  const t = n.trim(), e = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(t);
  if (e)
    return [
      parseInt(e[1] + e[1], 16) / 255,
      parseInt(e[2] + e[2], 16) / 255,
      parseInt(e[3] + e[3], 16) / 255
    ];
  const r = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(t);
  if (r)
    return [
      parseInt(r[1], 16) / 255,
      parseInt(r[2], 16) / 255,
      parseInt(r[3], 16) / 255
    ];
  if (typeof document != "undefined") {
    const i = document.createElement("canvas");
    i.width = i.height = 1;
    const l = i.getContext("2d");
    if (l) {
      l.fillStyle = "#808080", l.fillStyle = n, l.fillRect(0, 0, 1, 1);
      const s = l.getImageData(0, 0, 1, 1).data;
      return [s[0] / 255, s[1] / 255, s[2] / 255];
    }
  }
  return [0.5, 0.5, 0.5];
}
class Et {
  constructor(t, e, r = {}) {
    this.gl = null, this.program = null, this.loc = {}, this.raf = 0, this.running = !1, this.visible = !0, this.lastTs = null, this.startTs = null, this.flow = 0, this.ring = 0, this.inLevel = 0, this.outLevel = 0, this.stateLevel = 0, this.warn = 0, this.shown = null, this.detail = 1, this.resizeObserver = null, this.intersectionObserver = null, this.onContextLost = (l) => {
      l.preventDefault(), this.stop();
    }, this.onContextRestored = () => {
      this.build() && this.start();
    }, this.canvas = t, this.config = e, this.hooks = r;
    const i = t.getContext("webgl", {
      alpha: !0,
      premultipliedAlpha: !0,
      antialias: !0
    }) || t.getContext("experimental-webgl", {
      alpha: !0,
      premultipliedAlpha: !0
    });
    if (!i) {
      this.supported = !1;
      return;
    }
    this.gl = i, this.supported = this.build(), this.supported && (t.addEventListener("webglcontextlost", this.onContextLost), t.addEventListener("webglcontextrestored", this.onContextRestored), this.observe());
  }
  build() {
    const t = this.gl, e = this.compile(t.VERTEX_SHADER, mt), r = this.compile(t.FRAGMENT_SHADER, pt);
    if (!e || !r) return !1;
    const i = t.createProgram();
    if (!i) return !1;
    if (t.attachShader(i, e), t.attachShader(i, r), t.linkProgram(i), !t.getProgramParameter(i, t.LINK_STATUS))
      return console.error("[AI-Orb] link failed:", t.getProgramInfoLog(i)), !1;
    t.useProgram(i), this.program = i;
    const l = t.createBuffer();
    t.bindBuffer(t.ARRAY_BUFFER, l), t.bufferData(t.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), t.STATIC_DRAW);
    const s = t.getAttribLocation(i, "aPos");
    t.enableVertexAttribArray(s), t.vertexAttribPointer(s, 2, t.FLOAT, !1, 0, 0);
    for (const f of vt)
      this.loc[f] = t.getUniformLocation(i, f);
    return t.enable(t.BLEND), t.blendFunc(t.ONE, t.ONE_MINUS_SRC_ALPHA), !0;
  }
  compile(t, e) {
    const r = this.gl, i = r.createShader(t);
    return i ? (r.shaderSource(i, e), r.compileShader(i), r.getShaderParameter(i, r.COMPILE_STATUS) ? i : (console.error("[AI-Orb] shader compile failed:", r.getShaderInfoLog(i)), null)) : null;
  }
  observe() {
    typeof ResizeObserver != "undefined" && (this.resizeObserver = new ResizeObserver(() => this.resize()), this.resizeObserver.observe(this.canvas)), typeof IntersectionObserver != "undefined" && (this.intersectionObserver = new IntersectionObserver(
      (t) => {
        this.visible = t[0].isIntersecting;
      },
      { rootMargin: "120px" }
    ), this.intersectionObserver.observe(this.canvas));
  }
  resize() {
    const t = this.gl;
    if (!t) return;
    const e = { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
    if (!e.width || !e.height) return;
    this.detail = Math.min(1, Math.max(0, (Math.min(e.width, e.height) - 28) / 68));
    const r = Math.min(window.devicePixelRatio || 1, bt), i = Math.round(e.width * r), l = Math.round(e.height * r);
    (this.canvas.width !== i || this.canvas.height !== l) && (this.canvas.width = i, this.canvas.height = l, t.viewport(0, 0, i, l));
  }
  /** Merge a partial config. Cheap; safe to call on every React render. */
  update(t) {
    this.config = w(w({}, this.config), t);
  }
  setHooks(t) {
    this.hooks = t;
  }
  start() {
    if (!this.supported || this.running) return;
    this.running = !0, this.lastTs = null, this.startTs = null;
    const t = (e) => {
      if (this.running) {
        if (this.frame(e), this.config.still) {
          this.running = !1;
          return;
        }
        this.raf = requestAnimationFrame(t);
      }
    };
    this.raf = requestAnimationFrame(t);
  }
  stop() {
    this.running = !1, this.raf && cancelAnimationFrame(this.raf), this.raf = 0;
  }
  /** Draw exactly one frame — the poster used for reduced motion. */
  renderStill(t = 6) {
    this.supported && (this.resize(), this.shown = null, this.ease(1), this.stateLevel = this.config.level, this.draw(t, t, 0, 0, this.config.level));
  }
  /** Move the drawn colours a fraction `k` of the way to the configured ones. */
  ease(t) {
    const { stops: e, body: r } = this.config.colors, i = { c1: T(e[0]), c2: T(e[1]), c3: T(e[2]), body: T(r) };
    if (!this.shown) {
      this.shown = {
        c1: [...i.c1],
        c2: [...i.c2],
        c3: [...i.c3],
        body: [...i.body]
      };
      return;
    }
    for (const l of ["c1", "c2", "c3", "body"]) {
      const s = this.shown[l], f = i[l];
      for (let u = 0; u < 3; u++) s[u] += (f[u] - s[u]) * t;
    }
  }
  frame(t) {
    var a, c;
    this.startTs === null && (this.startTs = t, this.lastTs = t);
    const e = (t - this.startTs) / 1e3, r = Math.min((t - ((a = this.lastTs) != null ? a : t)) / 1e3, 0.05);
    this.lastTs = t;
    const i = O(ot(this.hooks.getInputLevel)), l = O(ot(this.hooks.getOutputLevel)), s = Math.min(1, r * 11);
    this.inLevel += (i - this.inLevel) * s, this.outLevel += (l - this.outLevel) * s, this.ease(Math.min(1, r * 7)), this.stateLevel += (this.config.level - this.stateLevel) * Math.min(1, r * 5);
    const f = Math.max(this.inLevel, this.outLevel), u = Math.min(wt, this.stateLevel + f * this.config.response), p = this.config.loudness;
    let h = 0;
    if (p) {
      const d = Math.max(1e-3, (c = p.softness) != null ? c : 0.08);
      h = O((f - p.threshold) / d);
    }
    this.warn += (h - this.warn) * Math.min(1, r * 8), this.flow += r * this.config.speed * (1 + u * 3.2), this.ring += r * (0.42 + this.inLevel * 0.5), this.visible && (this.resize(), this.draw(e, this.flow, this.ring, this.inLevel, u));
  }
  draw(t, e, r, i, l) {
    var E, F, A;
    const s = this.gl;
    if (!s || !this.program) return;
    const { state: f, field: u, grain: p, seed: h } = this.config;
    this.shown || this.ease(1);
    let { c1: a, c2: c, c3: d } = this.shown;
    const v = this.shown.body;
    if (this.warn > 1e-3) {
      const R = ((F = (E = this.config.loudness) == null ? void 0 : E.colors) != null ? F : yt).map(T), S = this.warn, C = (b, k) => [b[0] + (k[0] - b[0]) * S, b[1] + (k[1] - b[1]) * S, b[2] + (k[2] - b[2]) * S];
      a = C(a, R[0]), c = C(c, R[1]), d = C(d, R[2]);
    }
    const g = w(w({}, At[u]), this.config.rim), m = T(g.color);
    s.uniform1f(this.loc.uTime, t), s.uniform1f(this.loc.uFlow, e), s.uniform1f(this.loc.uRing, r), s.uniform1i(this.loc.uState, (A = gt[f]) != null ? A : 0), s.uniform1f(this.loc.uDark, u === "dark" ? 1 : 0), s.uniform1f(this.loc.uIn, Math.min(i, O(g.inputCap))), s.uniform1f(this.loc.uOut, l), s.uniform1f(this.loc.uGrain, p), s.uniform1f(this.loc.uSeed, h), s.uniform1f(this.loc.uDetail, this.detail), s.uniform3f(this.loc.uC1, a[0], a[1], a[2]), s.uniform3f(this.loc.uC2, c[0], c[1], c[2]), s.uniform3f(this.loc.uC3, d[0], d[1], d[2]), s.uniform3f(this.loc.uBody, v[0], v[1], v[2]), s.uniform1f(this.loc.uBodyAlpha, O(this.config.bodyOpacity)), s.uniform3f(this.loc.uRimColor, m[0], m[1], m[2]), s.uniform1f(this.loc.uRimInner, g.inner), s.uniform1f(this.loc.uRimFade, g.fade), s.uniform1f(this.loc.uRimStrength, g.strength), s.clearColor(0, 0, 0, 0), s.clear(s.COLOR_BUFFER_BIT), s.drawArrays(s.TRIANGLES, 0, 3);
  }
  destroy() {
    var t, e;
    this.stop(), (t = this.resizeObserver) == null || t.disconnect(), (e = this.intersectionObserver) == null || e.disconnect(), this.canvas.removeEventListener("webglcontextlost", this.onContextLost), this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored), this.gl && this.program && this.gl.deleteProgram(this.program), this.gl = null, this.program = null;
  }
}
function ot(n) {
  return typeof n == "function" ? n() : 0;
}
function O(n) {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
const Rt = {
  idle: { level: 0.22, response: 0 },
  listening: { level: 0.43, response: 1 },
  thinking: { level: 0.55, response: 0 },
  speaking: { level: 0.8, response: 1 },
  error: { level: 0, response: 0, palette: "crimson" },
  noInput: { level: 0, response: 0, palette: "porcelain" }
}, St = {
  idle: "Assistant idle",
  listening: "Assistant listening",
  thinking: "Assistant thinking",
  speaking: "Assistant speaking",
  error: "Assistant error",
  noInput: "No input detected"
}, Ct = "cubic-bezier(0.34, 1.45, 0.64, 1)", kt = "cubic-bezier(0.55, 0, 0.75, 0)";
function M(n) {
  return typeof n == "function" ? n : typeof n == "number" ? () => n : n && typeof n == "object" ? () => {
    var t;
    return (t = n.current) != null ? t : 0;
  } : () => 0;
}
function rt(n) {
  return typeof window != "undefined" && window.matchMedia ? window.matchMedia(n) : null;
}
function at(n, t) {
  return n ? n.addEventListener ? (n.addEventListener("change", t), () => n.removeEventListener("change", t)) : (n.addListener(t), () => n.removeListener(t)) : () => {
  };
}
function lt(n) {
  const t = document.documentElement, e = t.getAttribute("data-theme");
  return e === "dark" ? "dark" : e === "light" ? "light" : t.classList.contains("dark") || n != null && n.matches ? "dark" : "light";
}
function Mt(n, t = {}) {
  var N, U;
  let e = w({}, t), r = (N = e.state) != null ? N : "idle", i = (U = e.visible) != null ? U : !0, l = M(e.inputLevel), s = M(e.outputLevel);
  const f = rt("(prefers-color-scheme: dark)"), u = rt("(prefers-reduced-motion: reduce)");
  let p = lt(f), h = !!(u != null && u.matches);
  const a = document.createElement("div");
  a.setAttribute("role", "img");
  const c = a.style;
  c.position = "relative", c.borderRadius = "50%", c.overflow = "hidden", c.transform = "scale(0)";
  const d = document.createElement("canvas");
  d.setAttribute("aria-hidden", "true"), d.style.display = "block", d.style.width = "100%", d.style.height = "100%", a.appendChild(d), n.appendChild(a);
  const v = () => {
    var o;
    return (o = e.field) != null ? o : p;
  }, g = () => {
    var G, $, H, V, q, X, Y, W, j, K, J, Z, Q, tt;
    const o = w(w({}, Rt[r]), (G = e.states) == null ? void 0 : G[r]), y = (H = ($ = o.palette) != null ? $ : e.palette) != null ? H : st, L = ((V = nt[y]) != null ? V : nt[st])[v()], _ = {
      stops: (X = o.colors) != null ? X : o.palette ? L.stops : (q = e.colors) != null ? q : L.stops,
      body: (Y = e.bodyColor) != null ? Y : L.body
    };
    return {
      field: v(),
      colors: _,
      state: r,
      grain: (W = e.grain) != null ? W : 0.05,
      seed: (j = e.seed) != null ? j : 0,
      speed: (K = e.speed) != null ? K : 1,
      still: h,
      rim: e.rim,
      level: Math.min(1, Math.max(0, (J = o.level) != null ? J : 0)),
      response: Math.max(0, ((Z = o.response) != null ? Z : 0) * ((Q = e.audioResponse) != null ? Q : 1)),
      loudness: e.loudness,
      bodyOpacity: (tt = e.bodyOpacity) != null ? tt : 1
    };
  }, m = new Et(d, g(), {
    getInputLevel: () => l(),
    getOutputLevel: () => s()
  }), E = !m.supported;
  E && d.remove();
  const F = () => {
    var o, y;
    c.width = e.size ? `${e.size}px` : "100%", c.height = e.size ? `${e.size}px` : "100%", a.className = (o = e.className) != null ? o : "", a.setAttribute("aria-label", (y = e.label) != null ? y : St[r]);
  }, A = () => {
    F();
    const o = g();
    if (E) {
      const [y, L, _] = o.colors.stops;
      c.background = `radial-gradient(circle at 34% 30%, ${_}, ${L} 45%, ${y} 100%)`;
      return;
    }
    m.update(o), h && m.renderStill();
  }, R = () => {
    var o;
    return !h && ((o = e.transitionMs) != null ? o : 420) > 0;
  };
  let S = 0, C = 0;
  const b = (o) => {
    var L;
    const y = (L = e.transitionMs) != null ? L : 420;
    c.transition = R() ? `transform ${o ? y : Math.round(y * 0.75)}ms ${o ? Ct : kt}` : "none", c.transform = `scale(${o ? 1 : 0})`;
  }, k = () => {
    E || h || document.hidden || m.start();
  }, x = () => {
    if (cancelAnimationFrame(S), cancelAnimationFrame(C), c.pointerEvents = i ? "" : "none", i ? a.removeAttribute("aria-hidden") : a.setAttribute("aria-hidden", "true"), i) {
      if (k(), !R()) return b(!0);
      S = requestAnimationFrame(() => {
        C = requestAnimationFrame(() => b(!0));
      });
    } else
      b(!1), R() || m.stop();
  }, D = (o) => {
    o.target !== a || o.propertyName !== "transform" || i || m.stop();
  };
  a.addEventListener("transitionend", D);
  const z = () => {
    const o = lt(f);
    o !== p && (p = o, A());
  }, ct = at(f, z), I = typeof MutationObserver != "undefined" ? new MutationObserver(z) : null;
  I == null || I.observe(document.documentElement, { attributes: !0, attributeFilter: ["data-theme", "class"] });
  const ft = at(u, () => {
    h = !!(u != null && u.matches), A(), h ? m.stop() : i && k();
  }), B = () => {
    document.hidden ? m.stop() : i && k();
  };
  return document.addEventListener("visibilitychange", B), A(), h && !E && m.renderStill(), x(), {
    element: a,
    get state() {
      return r;
    },
    get visible() {
      return i;
    },
    setState(o) {
      o !== r && (r = o, A());
    },
    setInputLevel(o) {
      l = M(o);
    },
    setOutputLevel(o) {
      s = M(o);
    },
    show() {
      i || (i = !0, x());
    },
    hide() {
      i && (i = !1, x());
    },
    update(o) {
      "inputLevel" in o && (l = M(o.inputLevel)), "outputLevel" in o && (s = M(o.outputLevel)), o.state && (r = o.state), e = w(w({}, e), o), A(), o.visible !== void 0 && o.visible !== i && (i = o.visible, x());
    },
    destroy() {
      cancelAnimationFrame(S), cancelAnimationFrame(C), a.removeEventListener("transitionend", D), document.removeEventListener("visibilitychange", B), ct(), ft(), I == null || I.disconnect(), m.destroy(), a.remove();
    }
  };
}
function Ot(n, t = {}) {
  const { audioContext: e, bins: r = 160, sensitivity: i = 96, smoothing: l = 0.6 } = t, s = window.AudioContext || window.webkitAudioContext;
  if (!s) return { read: () => 0, disconnect: () => {
  } };
  const f = e != null ? e : new s(), u = !e;
  let p, h = null;
  n instanceof AnalyserNode ? p = n : (p = f.createAnalyser(), p.fftSize = 512, p.smoothingTimeConstant = l, typeof MediaStream != "undefined" && n instanceof MediaStream ? h = f.createMediaStreamSource(n) : (h = f.createMediaElementSource(n), h.connect(f.destination)), h.connect(p));
  const a = new Uint8Array(p.frequencyBinCount), c = Math.min(a.length, r), d = () => void f.resume();
  f.state === "suspended" && (window.addEventListener("pointerdown", d, { once: !0 }), window.addEventListener("keydown", d, { once: !0 }));
  let v = !1;
  return {
    read() {
      if (v) return 0;
      p.getByteFrequencyData(a);
      let g = 0;
      for (let m = 0; m < c; m++) g += a[m] * a[m];
      return Math.min(1, Math.sqrt(g / c) / i);
    },
    disconnect() {
      if (!v) {
        v = !0, window.removeEventListener("pointerdown", d), window.removeEventListener("keydown", d);
        try {
          h == null || h.disconnect(), n instanceof AnalyserNode || p.disconnect();
        } catch (g) {
        }
        u && f.close();
      }
    }
  };
}
export {
  st as DEFAULT_PALETTE,
  At as DEFAULT_RIM,
  Rt as DEFAULT_STATE_STYLES,
  Ot as connectAudioLevel,
  Mt as createOrb,
  Tt as dbToLevel,
  nt as orbPalettes
};
//# sourceMappingURL=ai-orb.mjs.map
