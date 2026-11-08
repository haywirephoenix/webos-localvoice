var AIOrb=(function(g){"use strict";var Ie=Object.defineProperty;var fe=Object.getOwnPropertySymbols;var Oe=Object.prototype.hasOwnProperty,Me=Object.prototype.propertyIsEnumerable;var ue=(g,v,b)=>v in g?Ie(g,v,{enumerable:!0,configurable:!0,writable:!0,value:b}):g[v]=b,L=(g,v)=>{for(var b in v||(v={}))Oe.call(v,b)&&ue(g,b,v[b]);if(fe)for(var b of fe(v))Me.call(v,b)&&ue(g,b,v[b]);return g};const v={ember:{light:{stops:["#d92a0f","#f7781f","#ffd48c"],body:"#f4f0ee"},dark:{stops:["#ff5a1f","#ff9d3d","#ffe0a8"],body:"#0a0708"}},iris:{light:{stops:["#fa9ec7","#dbbcf2","#8ac9fa"],body:"#f6f4f7"},dark:{stops:["#2a85f5","#59d4fc","#9e6bfa"],body:"#07080e"}},moss:{light:{stops:["#1f8f6b","#5cc79a","#c9edd8"],body:"#eef3f0"},dark:{stops:["#1fbd86","#67e8b4","#c2f5dd"],body:"#050b09"}},porcelain:{light:{stops:["#b8c2cf","#d9e0e8","#f4f7fa"],body:"#f7f8fa"},dark:{stops:["#6d7f96","#a9bccf","#e2ecf5"],body:"#080a0d"}},spectrum:{light:{stops:["#2f8ff0","#f0972a","#8b5cf6"],body:"#f5f6f8"},dark:{stops:["#3ba0ff","#ffab3d","#a077ff"],body:"#070910"}},discharge:{light:{stops:["#2b3ecc","#6f8dff","#e6ecff"],body:"#eef0f7"},dark:{stops:["#1b2fd6","#7d97ff","#f0f2ff"],body:"#04060f"}},crimson:{light:{stops:["#b3121c","#e5383b","#ff8a80"],body:"#f6eeee"},dark:{stops:["#d0161f","#ff4538","#ff9a8f"],body:"#0d0607"}}},b="spectrum",de=`
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`,he=`
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
`,me={idle:0,listening:1,thinking:2,speaking:3,error:4,noInput:5},pe=["uTime","uFlow","uRing","uState","uDark","uIn","uOut","uGrain","uSeed","uDetail","uC1","uC2","uC3","uBody","uBodyAlpha","uRimColor","uRimInner","uRimFade","uRimStrength"],ge=2,ve=1.5,be=["#c8141e","#ff3b30","#ff8a80"];function we(n,e=-60){return F((n-e)/-e)}const N={light:{color:"#8cc2f0",inner:.72,fade:.88,strength:.26,inputCap:1},dark:{color:"#85d6ff",inner:.72,fade:.88,strength:.64,inputCap:1}},x=new Map;function M(n){let e=x.get(n);return e||(e=ye(n),x.size>256&&x.clear(),x.set(n,e)),e}function ye(n){const e=n.trim(),t=/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(e);if(t)return[parseInt(t[1]+t[1],16)/255,parseInt(t[2]+t[2],16)/255,parseInt(t[3]+t[3],16)/255];const r=/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(e);if(r)return[parseInt(r[1],16)/255,parseInt(r[2],16)/255,parseInt(r[3],16)/255];if(typeof document!="undefined"){const i=document.createElement("canvas");i.width=i.height=1;const l=i.getContext("2d");if(l){l.fillStyle="#808080",l.fillStyle=n,l.fillRect(0,0,1,1);const s=l.getImageData(0,0,1,1).data;return[s[0]/255,s[1]/255,s[2]/255]}}return[.5,.5,.5]}class Ae{constructor(e,t,r={}){this.gl=null,this.program=null,this.loc={},this.raf=0,this.running=!1,this.visible=!0,this.lastTs=null,this.startTs=null,this.flow=0,this.ring=0,this.inLevel=0,this.outLevel=0,this.stateLevel=0,this.warn=0,this.shown=null,this.detail=1,this.resizeObserver=null,this.intersectionObserver=null,this.onContextLost=l=>{l.preventDefault(),this.stop()},this.onContextRestored=()=>{this.build()&&this.start()},this.canvas=e,this.config=t,this.hooks=r;const i=e.getContext("webgl",{alpha:!0,premultipliedAlpha:!0,antialias:!0})||e.getContext("experimental-webgl",{alpha:!0,premultipliedAlpha:!0});if(!i){this.supported=!1;return}this.gl=i,this.supported=this.build(),this.supported&&(e.addEventListener("webglcontextlost",this.onContextLost),e.addEventListener("webglcontextrestored",this.onContextRestored),this.observe())}build(){const e=this.gl,t=this.compile(e.VERTEX_SHADER,de),r=this.compile(e.FRAGMENT_SHADER,he);if(!t||!r)return!1;const i=e.createProgram();if(!i)return!1;if(e.attachShader(i,t),e.attachShader(i,r),e.linkProgram(i),!e.getProgramParameter(i,e.LINK_STATUS))return console.error("[AI-Orb] link failed:",e.getProgramInfoLog(i)),!1;e.useProgram(i),this.program=i;const l=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,l),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),e.STATIC_DRAW);const s=e.getAttribLocation(i,"aPos");e.enableVertexAttribArray(s),e.vertexAttribPointer(s,2,e.FLOAT,!1,0,0);for(const f of pe)this.loc[f]=e.getUniformLocation(i,f);return e.enable(e.BLEND),e.blendFunc(e.ONE,e.ONE_MINUS_SRC_ALPHA),!0}compile(e,t){const r=this.gl,i=r.createShader(e);return i?(r.shaderSource(i,t),r.compileShader(i),r.getShaderParameter(i,r.COMPILE_STATUS)?i:(console.error("[AI-Orb] shader compile failed:",r.getShaderInfoLog(i)),null)):null}observe(){typeof ResizeObserver!="undefined"&&(this.resizeObserver=new ResizeObserver(()=>this.resize()),this.resizeObserver.observe(this.canvas)),typeof IntersectionObserver!="undefined"&&(this.intersectionObserver=new IntersectionObserver(e=>{this.visible=e[0].isIntersecting},{rootMargin:"120px"}),this.intersectionObserver.observe(this.canvas))}resize(){const e=this.gl;if(!e)return;const t={width:this.canvas.clientWidth,height:this.canvas.clientHeight};if(!t.width||!t.height)return;this.detail=Math.min(1,Math.max(0,(Math.min(t.width,t.height)-28)/68));const r=Math.min(window.devicePixelRatio||1,ge),i=Math.round(t.width*r),l=Math.round(t.height*r);(this.canvas.width!==i||this.canvas.height!==l)&&(this.canvas.width=i,this.canvas.height=l,e.viewport(0,0,i,l))}update(e){this.config=L(L({},this.config),e)}setHooks(e){this.hooks=e}start(){if(!this.supported||this.running)return;this.running=!0,this.lastTs=null,this.startTs=null;const e=t=>{if(this.running){if(this.frame(t),this.config.still){this.running=!1;return}this.raf=requestAnimationFrame(e)}};this.raf=requestAnimationFrame(e)}stop(){this.running=!1,this.raf&&cancelAnimationFrame(this.raf),this.raf=0}renderStill(e=6){this.supported&&(this.resize(),this.shown=null,this.ease(1),this.stateLevel=this.config.level,this.draw(e,e,0,0,this.config.level))}ease(e){const{stops:t,body:r}=this.config.colors,i={c1:M(t[0]),c2:M(t[1]),c3:M(t[2]),body:M(r)};if(!this.shown){this.shown={c1:[...i.c1],c2:[...i.c2],c3:[...i.c3],body:[...i.body]};return}for(const l of["c1","c2","c3","body"]){const s=this.shown[l],f=i[l];for(let u=0;u<3;u++)s[u]+=(f[u]-s[u])*e}}frame(e){var a,c;this.startTs===null&&(this.startTs=e,this.lastTs=e);const t=(e-this.startTs)/1e3,r=Math.min((e-((a=this.lastTs)!=null?a:e))/1e3,.05);this.lastTs=e;const i=F(U(this.hooks.getInputLevel)),l=F(U(this.hooks.getOutputLevel)),s=Math.min(1,r*11);this.inLevel+=(i-this.inLevel)*s,this.outLevel+=(l-this.outLevel)*s,this.ease(Math.min(1,r*7)),this.stateLevel+=(this.config.level-this.stateLevel)*Math.min(1,r*5);const f=Math.max(this.inLevel,this.outLevel),u=Math.min(ve,this.stateLevel+f*this.config.response),p=this.config.loudness;let d=0;if(p){const h=Math.max(.001,(c=p.softness)!=null?c:.08);d=F((f-p.threshold)/h)}this.warn+=(d-this.warn)*Math.min(1,r*8),this.flow+=r*this.config.speed*(1+u*3.2),this.ring+=r*(.42+this.inLevel*.5),this.visible&&(this.resize(),this.draw(t,this.flow,this.ring,this.inLevel,u))}draw(e,t,r,i,l){var T,D,S;const s=this.gl;if(!s||!this.program)return;const{state:f,field:u,grain:p,seed:d}=this.config;this.shown||this.ease(1);let{c1:a,c2:c,c3:h}=this.shown;const y=this.shown.body;if(this.warn>.001){const C=((D=(T=this.config.loudness)==null?void 0:T.colors)!=null?D:be).map(M),k=this.warn,I=(A,O)=>[A[0]+(O[0]-A[0])*k,A[1]+(O[1]-A[1])*k,A[2]+(O[2]-A[2])*k];a=I(a,C[0]),c=I(c,C[1]),h=I(h,C[2])}const w=L(L({},N[u]),this.config.rim),m=M(w.color);s.uniform1f(this.loc.uTime,e),s.uniform1f(this.loc.uFlow,t),s.uniform1f(this.loc.uRing,r),s.uniform1i(this.loc.uState,(S=me[f])!=null?S:0),s.uniform1f(this.loc.uDark,u==="dark"?1:0),s.uniform1f(this.loc.uIn,Math.min(i,F(w.inputCap))),s.uniform1f(this.loc.uOut,l),s.uniform1f(this.loc.uGrain,p),s.uniform1f(this.loc.uSeed,d),s.uniform1f(this.loc.uDetail,this.detail),s.uniform3f(this.loc.uC1,a[0],a[1],a[2]),s.uniform3f(this.loc.uC2,c[0],c[1],c[2]),s.uniform3f(this.loc.uC3,h[0],h[1],h[2]),s.uniform3f(this.loc.uBody,y[0],y[1],y[2]),s.uniform1f(this.loc.uBodyAlpha,F(this.config.bodyOpacity)),s.uniform3f(this.loc.uRimColor,m[0],m[1],m[2]),s.uniform1f(this.loc.uRimInner,w.inner),s.uniform1f(this.loc.uRimFade,w.fade),s.uniform1f(this.loc.uRimStrength,w.strength),s.clearColor(0,0,0,0),s.clear(s.COLOR_BUFFER_BIT),s.drawArrays(s.TRIANGLES,0,3)}destroy(){var e,t;this.stop(),(e=this.resizeObserver)==null||e.disconnect(),(t=this.intersectionObserver)==null||t.disconnect(),this.canvas.removeEventListener("webglcontextlost",this.onContextLost),this.canvas.removeEventListener("webglcontextrestored",this.onContextRestored),this.gl&&this.program&&this.gl.deleteProgram(this.program),this.gl=null,this.program=null}}function U(n){return typeof n=="function"?n():0}function F(n){return Number.isFinite(n)?Math.min(1,Math.max(0,n)):0}const G={idle:{level:.22,response:0},listening:{level:.43,response:1},thinking:{level:.55,response:0},speaking:{level:.8,response:1},error:{level:0,response:0,palette:"crimson"},noInput:{level:0,response:0,palette:"porcelain"}},Le={idle:"Assistant idle",listening:"Assistant listening",thinking:"Assistant thinking",speaking:"Assistant speaking",error:"Assistant error",noInput:"No input detected"},Ee="cubic-bezier(0.34, 1.45, 0.64, 1)",Se="cubic-bezier(0.55, 0, 0.75, 0)";function _(n){return typeof n=="function"?n:typeof n=="number"?()=>n:n&&typeof n=="object"?()=>{var e;return(e=n.current)!=null?e:0}:()=>0}function $(n){return typeof window!="undefined"&&window.matchMedia?window.matchMedia(n):null}function H(n,e){return n?n.addEventListener?(n.addEventListener("change",e),()=>n.removeEventListener("change",e)):(n.addListener(e),()=>n.removeListener(e)):()=>{}}function V(n){const e=document.documentElement,t=e.getAttribute("data-theme");return t==="dark"?"dark":t==="light"?"light":e.classList.contains("dark")||n!=null&&n.matches?"dark":"light"}function Re(n,e={}){var W,j;let t=L({},e),r=(W=t.state)!=null?W:"idle",i=(j=t.visible)!=null?j:!0,l=_(t.inputLevel),s=_(t.outputLevel);const f=$("(prefers-color-scheme: dark)"),u=$("(prefers-reduced-motion: reduce)");let p=V(f),d=!!(u!=null&&u.matches);const a=document.createElement("div");a.setAttribute("role","img");const c=a.style;c.position="relative",c.borderRadius="50%",c.overflow="hidden",c.transform="scale(0)";const h=document.createElement("canvas");h.setAttribute("aria-hidden","true"),h.style.display="block",h.style.width="100%",h.style.height="100%",a.appendChild(h),n.appendChild(a);const y=()=>{var o;return(o=t.field)!=null?o:p},w=()=>{var K,J,Z,Q,ee,te,ie,ne,se,oe,re,ae,le,ce;const o=L(L({},G[r]),(K=t.states)==null?void 0:K[r]),E=(Z=(J=o.palette)!=null?J:t.palette)!=null?Z:b,R=((Q=v[E])!=null?Q:v[b])[y()],B={stops:(te=o.colors)!=null?te:o.palette?R.stops:(ee=t.colors)!=null?ee:R.stops,body:(ie=t.bodyColor)!=null?ie:R.body};return{field:y(),colors:B,state:r,grain:(ne=t.grain)!=null?ne:.05,seed:(se=t.seed)!=null?se:0,speed:(oe=t.speed)!=null?oe:1,still:d,rim:t.rim,level:Math.min(1,Math.max(0,(re=o.level)!=null?re:0)),response:Math.max(0,((ae=o.response)!=null?ae:0)*((le=t.audioResponse)!=null?le:1)),loudness:t.loudness,bodyOpacity:(ce=t.bodyOpacity)!=null?ce:1}},m=new Ae(h,w(),{getInputLevel:()=>l(),getOutputLevel:()=>s()}),T=!m.supported;T&&h.remove();const D=()=>{var o,E;c.width=t.size?`${t.size}px`:"100%",c.height=t.size?`${t.size}px`:"100%",a.className=(o=t.className)!=null?o:"",a.setAttribute("aria-label",(E=t.label)!=null?E:Le[r])},S=()=>{D();const o=w();if(T){const[E,R,B]=o.colors.stops;c.background=`radial-gradient(circle at 34% 30%, ${B}, ${R} 45%, ${E} 100%)`;return}m.update(o),d&&m.renderStill()},C=()=>{var o;return!d&&((o=t.transitionMs)!=null?o:420)>0};let k=0,I=0;const A=o=>{var R;const E=(R=t.transitionMs)!=null?R:420;c.transition=C()?`transform ${o?E:Math.round(E*.75)}ms ${o?Ee:Se}`:"none",c.transform=`scale(${o?1:0})`},O=()=>{T||d||document.hidden||m.start()},z=()=>{if(cancelAnimationFrame(k),cancelAnimationFrame(I),c.pointerEvents=i?"":"none",i?a.removeAttribute("aria-hidden"):a.setAttribute("aria-hidden","true"),i){if(O(),!C())return A(!0);k=requestAnimationFrame(()=>{I=requestAnimationFrame(()=>A(!0))})}else A(!1),C()||m.stop()},Y=o=>{o.target!==a||o.propertyName!=="transform"||i||m.stop()};a.addEventListener("transitionend",Y);const q=()=>{const o=V(f);o!==p&&(p=o,S())},Ce=H(f,q),P=typeof MutationObserver!="undefined"?new MutationObserver(q):null;P==null||P.observe(document.documentElement,{attributes:!0,attributeFilter:["data-theme","class"]});const ke=H(u,()=>{d=!!(u!=null&&u.matches),S(),d?m.stop():i&&O()}),X=()=>{document.hidden?m.stop():i&&O()};return document.addEventListener("visibilitychange",X),S(),d&&!T&&m.renderStill(),z(),{element:a,get state(){return r},get visible(){return i},setState(o){o!==r&&(r=o,S())},setInputLevel(o){l=_(o)},setOutputLevel(o){s=_(o)},show(){i||(i=!0,z())},hide(){i&&(i=!1,z())},update(o){"inputLevel"in o&&(l=_(o.inputLevel)),"outputLevel"in o&&(s=_(o.outputLevel)),o.state&&(r=o.state),t=L(L({},t),o),S(),o.visible!==void 0&&o.visible!==i&&(i=o.visible,z())},destroy(){cancelAnimationFrame(k),cancelAnimationFrame(I),a.removeEventListener("transitionend",Y),document.removeEventListener("visibilitychange",X),Ce(),ke(),P==null||P.disconnect(),m.destroy(),a.remove()}}}function Te(n,e={}){const{audioContext:t,bins:r=160,sensitivity:i=96,smoothing:l=.6}=e,s=window.AudioContext||window.webkitAudioContext;if(!s)return{read:()=>0,disconnect:()=>{}};const f=t!=null?t:new s,u=!t;let p,d=null;n instanceof AnalyserNode?p=n:(p=f.createAnalyser(),p.fftSize=512,p.smoothingTimeConstant=l,typeof MediaStream!="undefined"&&n instanceof MediaStream?d=f.createMediaStreamSource(n):(d=f.createMediaElementSource(n),d.connect(f.destination)),d.connect(p));const a=new Uint8Array(p.frequencyBinCount),c=Math.min(a.length,r),h=()=>void f.resume();f.state==="suspended"&&(window.addEventListener("pointerdown",h,{once:!0}),window.addEventListener("keydown",h,{once:!0}));let y=!1;return{read(){if(y)return 0;p.getByteFrequencyData(a);let w=0;for(let m=0;m<c;m++)w+=a[m]*a[m];return Math.min(1,Math.sqrt(w/c)/i)},disconnect(){if(!y){y=!0,window.removeEventListener("pointerdown",h),window.removeEventListener("keydown",h);try{d==null||d.disconnect(),n instanceof AnalyserNode||p.disconnect()}catch(w){}u&&f.close()}}}}return g.DEFAULT_PALETTE=b,g.DEFAULT_RIM=N,g.DEFAULT_STATE_STYLES=G,g.connectAudioLevel=Te,g.createOrb=Re,g.dbToLevel=we,g.orbPalettes=v,Object.defineProperty(g,Symbol.toStringTag,{value:"Module"}),g})({});
//# sourceMappingURL=ai-orb.js.map
