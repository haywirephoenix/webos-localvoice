# orb/

The voice-recognition orb: a WebGL orb that shows the recogniser's state and
reacts to audio level. Plain JS, no framework, no runtime dependencies.

## Files

| File | What it is |
|---|---|
| `ai-orb.js` | Classic script. Defines the global `AIOrb`. Use this one on webOS. |
| `ai-orb.mjs` | Same code as an ES module, for environments that support modules. |
| `*.map` | Source maps. |
| `orb.config.json` | The look: exported from the playground. Edit or re-export to restyle. |
| `demo.html` | Working example: keys 1-6 switch state, H hides/shows, Up/Down change input level. |

**Do not edit `ai-orb.js` / `ai-orb.mjs`.** They are minified build output.
The source is the `local-voice` branch of
[haywirephoenix/AI-Orb](https://github.com/haywirephoenix/AI-Orb/tree/local-voice), a fork of
[weeeha/AI-Orb](https://github.com/weeeha/AI-Orb). Change `src/` there, run
`npm run build:lib`, and copy `dist/ai-orb.js`, `dist/ai-orb.mjs` and the maps
back here. Tune the look with `npm run dev` (the playground) and its Export
panel, which produces `orb.config.json`.

The bundle targets ES2015 so it runs on older TV Chromium builds. Load it with a
plain `<script src>` tag, not `type="module"`.

## Usage

```html
<div id="orb"></div>
<script src="ai-orb.js"></script>
<script>
  fetch("orb.config.json")
    .then(function (r) { return r.ok ? r.json() : {} })
    .catch(function () { return {} })
    .then(function (config) {
      var level = 0 // updated by your audio source
      var orb = AIOrb.createOrb(document.getElementById("orb"), Object.assign({}, config, {
        state: "idle",
        inputLevel: function () { return level },
      }))
    })
</script>
```

`createOrb(container, options)` appends its own element to `container` and
returns a handle. With `size` in the config the orb is that many px square;
without it, it fills the container.

## Handle

| Member | Does |
|---|---|
| `setState(s)` | `"idle"`, `"listening"`, `"thinking"`, `"speaking"`, `"error"` or `"noInput"`. Colours and motion ease to the new state (about 0.3-0.4 s). |
| `setInputLevel(src)` | Mic level source: a number (held) or a function read every frame. |
| `setOutputLevel(src)` | Agent-speech level source, same forms. |
| `show()` / `hide()` | Grow from 0 / shrink to 0. Rendering pauses once hidden, so a hidden orb costs no GPU. |
| `update(partial)` | Merge any config or option at runtime. Cheap, no WebGL teardown. |
| `destroy()` | Stop, remove listeners, remove the element. |
| `state`, `visible`, `element` | Read-only. |

Options at creation: everything in the config, plus `state`, `visible` (default
`true`; it grows in on creation), `inputLevel`, `outputLevel`, `className`.

## Recogniser states

| Recogniser phase | Orb state |
|---|---|
| listening | `"listening"` |
| recognising | `"thinking"` |
| heard | `"speaking"` |
| failed (recogniser error, network, permission) | `"error"` |
| nothing heard (silence, no match) | `"noInput"` |
| not active | `"idle"`, or `hide()` |

Each state has a resting energy (`level`) and its own palette in
`orb.config.json`. By default only listening and speaking react to sound
(`response: 0` on the others).

`error` and `noInput` have built-in palettes, so they look right even with no
config: `error` uses `crimson` (red) and `noInput` uses `porcelain` (pale grey)
at a very low level, so the orb is nearly still. Like the other states, the
config can override them.

## Audio input

- **Levels are 0-1 and pulled, not pushed.** The orb calls your level function
  once per animation frame. Keep the latest value in a variable and return it.
  Calling `setInputLevel(number)` repeatedly also works but is not needed.
- **Smoothing is built in.** Pass raw values; the orb eases them itself.
- **What the level drives:**
  - The bodies: `energy = state level + max(input, output) × state response × audioResponse`, capped at 1.5. Higher energy spreads the bodies toward the glass and speeds them up.
  - The outer ring and listening pulse: input only, capped at `rim.inputCap`, so a loud mic cannot blow out the edge.
  - The loudness warning: above `loudness.threshold` the colours fade to red (`loudness.colors` overrides) and back when it drops.
- **From a mic stream:**
  ```js
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    var mic = AIOrb.connectAudioLevel(stream) // { read(), disconnect() }
    orb.setInputLevel(mic.read)
  })
  ```
  Options: `{ sensitivity }` (default 96, lower is more sensitive), `bins`,
  `smoothing`, `audioContext`.
- **From the recogniser's own volume in dB:** `AIOrb.dbToLevel(db)` maps
  -60 dB to 0 and 0 dB to 1, linearly (`dbToLevel(db, floor)` changes the
  floor). The playground's test-input and threshold sliders use the same
  mapping, so dB values tuned there carry over.

## orb.config.json

All fields are optional; anything missing uses the built-in default.

| Field | Meaning |
|---|---|
| `palette` | Base palette: `ember`, `iris`, `moss`, `porcelain`, `spectrum`, `discharge`, `crimson`. Used by any state without its own. |
| `colors` | Three explicit hex stops instead of a palette. |
| `bodyColor` | Ground colour between the bodies. Defaults to the palette's. |
| `bodyOpacity` | 0-1. Below 1 the page shows through between the bodies. |
| `size` | px. Omit to fill the container. |
| `field` | `"light"` or `"dark"`. Omit to follow the page (`data-theme`, a `dark` class, or the OS setting). |
| `states.<state>.level` | 0-1 resting energy. |
| `states.<state>.response` | How much sound moves the bodies in that state. 0 ignores sound. |
| `states.<state>.palette` / `.colors` | That state's colours. |
| `audioResponse` | Global multiplier on all states' response. |
| `rim.inner` / `rim.fade` | Ring radii, 0 centre to 1 edge: rises from `inner`, fades out from `fade`. |
| `rim.strength` / `rim.color` | Ring brightness and colour. |
| `rim.inputCap` | 0-1 ceiling on the input level the ring reacts to. |
| `loudness.threshold` | 0-1 level where the red warning starts (`dbToLevel(-12)` = 0.8). |
| `loudness.softness` | Level range the fade takes. Default 0.08. |
| `transitionMs` | Grow length in ms; shrink takes 75%. 0 disables. |
| `grain`, `seed`, `speed`, `label` | Film grain, decorrelation, ambient speed, screen-reader label. |

Also exported on `AIOrb`: `orbPalettes`, `DEFAULT_PALETTE`,
`DEFAULT_STATE_STYLES`, `DEFAULT_RIM`.

## Behaviour to know

- Honours `prefers-reduced-motion`: draws one still frame per change and
  shows/hides without animation.
- Pauses when the page is hidden (`visibilitychange`) and resumes on return,
  unless hidden with `hide()`.
- Without WebGL it falls back to a static CSS gradient in the same colours.
