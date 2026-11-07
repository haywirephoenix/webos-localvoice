# Third-party software

The IPK contains these, unchanged, in `runtime/`. Their licence texts are in `runtime/licences/`.

| Part | Files | Licence | Source |
|---|---|---|---|
| sherpa-onnx 2.0.1 | `lib/libsherpa-onnx-c-api.so` | Apache-2.0 | [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) |
| ONNX Runtime 1.28.2, from the same release | `lib/libonnxruntime.so` | MIT | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) |
| GNU C Library 2.35 (`libc6` 2.35-0ubuntu3.8) and GCC 12.3.0 runtime libraries (`libgcc-s1`, `libstdc++6` 12.3.0-1ubuntu1~22.04), from Ubuntu 22.04.5 armhf | `lib/ld-linux-armhf.so.3`, `libc.so.6`, `libm.so.6`, `libdl.so.2`, `libpthread.so.0`, `librt.so.1`, `libgcc_s.so.1`, `libstdc++.so.6` | LGPL-2.1+ (glibc), GPL-3.0+ with the GCC Runtime Library Exception (GCC) | [Ubuntu base](https://cdimage.ubuntu.com/ubuntu-base/releases/22.04/release/); the matching source is attached to each [release](https://github.com/haywirephoenix/webos-localvoice/releases) |

Speech models are not in the IPK. Moonshine (MIT, [moonshine-ai/moonshine](https://github.com/moonshine-ai/moonshine)), in the sherpa-onnx exports listed in `app/models.json`, is downloaded to the TV only if chosen, with its `LICENSE` beside it.

`runtime/bin/lvengine` is not third-party: it is built from `native/lvengine.c` in this repository, under its MIT licence, and links to the libraries above.

The C libraries are there because the sherpa-onnx build needs a newer glibc than the TV has. They are used only by the recogniser, through their own loader, and nothing in the TV's system folders changes.

The way the remote's microphone is opened, and the silence rules, follow [cleanyourtv-WebOS](https://github.com/lasharor/cleanyourtv-WebOS) (MIT). Taking a service's name with a stub follows [lifesgoodwithoutspying](https://github.com/lewisdoesstuff/lifesgoodwithoutspying).
