# Third-party software

The IPK contains these, unchanged, in `runtime/`:

| Part | Files | Licence | Source |
|---|---|---|---|
| sherpa-onnx 2.0.1 | `lib/libsherpa-onnx-c-api.so` | Apache-2.0 | [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) |
| ONNX Runtime, from the same release | `lib/libonnxruntime.so` | MIT | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) |
| Moonshine tiny-en, quantized, sherpa-onnx export of 2026-02-27 | `model/` | MIT, see `model/LICENSE` | [moonshine-ai/moonshine](https://github.com/moonshine-ai/moonshine) |
| GNU C Library 2.35 and GCC runtime libraries, from Ubuntu 22.04.5 armhf | `lib/ld-linux-armhf.so.3`, `libc.so.6`, `libm.so.6`, `libdl.so.2`, `libpthread.so.0`, `librt.so.1`, `libgcc_s.so.1`, `libstdc++.so.6` | LGPL-2.1+ (glibc), GPL-3.0+ with the GCC Runtime Library Exception (GCC) | [Ubuntu base](https://cdimage.ubuntu.com/ubuntu-base/releases/22.04/release/); sources from the `glibc` and `gcc-12` packages of Ubuntu 22.04 |

The C libraries are there because the sherpa-onnx build needs a newer glibc than the TV has. They are used only by the recogniser, through their own loader, and nothing in the TV's system folders changes.

The way the remote's microphone is opened, and the silence rules, follow [cleanyourtv-WebOS](https://github.com/lasharor/cleanyourtv-WebOS) (MIT). Taking a service's name with a stub follows [lifesgoodwithoutspying](https://github.com/lewisdoesstuff/lifesgoodwithoutspying).
