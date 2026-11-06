#!/usr/bin/env python3
"""Build dist/com.haywire.localvoice_<version>_all.ipk.

Downloads the engine, the model and the C libraries into .cache (each pinned to a checksum),
compiles native/lvengine.c for 32-bit ARM and packs the IPK.

Needs Python 3 and zig (pip install ziglang).
Usage: tools/build.py [--out dist] [--sources]

Also writes the release's manifest to dist, and docs/apps.json, the Homebrew Channel repository
served from GitHub Pages. The checksum in both is of this build, so publish the IPK of the same
run. --sources copies the source of the bundled GPL and LGPL libraries to dist/sources, to attach
to the release.
"""
import argparse
import hashlib
import io
import json
import os
import posixpath
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
APP = "com.haywire.localvoice"
CARD = APP + ".card"
SHERPA = "2.0.1"
GITHUB = "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
MODEL_DIR = "sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27"
SOURCES = {
    "sherpa": (GITHUB + "v%s/sherpa-onnx-v%s-linux-arm-gnueabihf-shared.tar.bz2" % (SHERPA, SHERPA),
               "099c6bc956b26df246712ff9902419ff9cbc938c014177ea3e205b32675b48d5"),
    "model": (GITHUB + "asr-models/%s.tar.bz2" % MODEL_DIR,
              "9ec31b342d8fa3240c3b81b8f82e1cf7e3ac467c93ca5a999b741d5887164f8d"),
    "ubuntu": ("https://cdimage.ubuntu.com/ubuntu-base/releases/22.04/release/ubuntu-base-22.04.5-base-armhf.tar.gz",
               "fd77cb0659326b75c08ce06b6b8649d2e13ef9a704a8e9212fec32cb97d42add"),
    "header": ("https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v%s/sherpa-onnx/c-api/c-api.h" % SHERPA,
               "5698f38ba09ad2bdf085c56a6cbbd7741acf15e25f4ce5c7097b9702cadf437f"),
}
LAUNCHPAD = "https://launchpad.net/ubuntu/+archive/primary/+sourcefiles/"
GLIBC = LAUNCHPAD + "glibc/2.35-0ubuntu3.8/"
GCC = LAUNCHPAD + "gcc-12/12.3.0-1ubuntu1~22.04/"
# Source of the libraries taken from Ubuntu, which the LGPL and GPL say must be on offer with them.
LIBRARY_SOURCES = {
    "glibc-orig": (GLIBC + "glibc_2.35.orig.tar.xz", "5123732f6b67ccd319305efd399971d58592122bcc2a6518a1bd2510dd0cf52e"),
    "glibc-debian": (GLIBC + "glibc_2.35-0ubuntu3.8.debian.tar.xz", "a39f2c9db94d01e20753754ff44d16984e3d2ab47ec2da886adee8c5b1fc5a19"),
    "glibc-dsc": (GLIBC + "glibc_2.35-0ubuntu3.8.dsc", "5fb394b60034e84d87714a7d80a6808a54b7d4214bbe097e89d4d2bf117391c3"),
    "gcc-orig": (GCC + "gcc-12_12.3.0.orig.tar.gz", "62b0fc89b6d41f9df2470d0fb4995f6ff5885f910518a2c6a44a6888ea5a9ea1"),
    "gcc-debian": (GCC + "gcc-12_12.3.0-1ubuntu1~22.04.debian.tar.xz", "023f6a9caf0d4ebc5b158f305802c22f6c49e51824fe62c7cce75b9b45bfecb4"),
    "gcc-dsc": (GCC + "gcc-12_12.3.0-1ubuntu1~22.04.dsc", "0e2b75b952a0bcc33a03889c52fc57fa06496d7c6e26eb77a5a5c51307cf3274"),
}
# None of these reach us with the engine, and they all share a file name, so the key names the file.
LICENCES = {
    "sherpa-onnx-LICENSE": ("https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v%s/LICENSE" % SHERPA,
                            "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"),
    "onnxruntime-LICENSE": ("https://raw.githubusercontent.com/microsoft/onnxruntime/v1.28.2/LICENSE",
                            "2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c"),
    "onnxruntime-ThirdPartyNotices.txt": ("https://raw.githubusercontent.com/microsoft/onnxruntime/v1.28.2/ThirdPartyNotices.txt",
                                          "0e07b95f3a8d6230037707c5c4a2b554d12c4cb67369669ac255635528ffcee2"),
}
SOURCES.update(LIBRARY_SOURCES)
SOURCES.update(LICENCES)
UBUNTU_LICENCES = {"usr/share/doc/libc6/copyright": "glibc-copyright", "usr/share/doc/gcc-12-base/copyright": "gcc-copyright",
                   "usr/share/common-licenses/LGPL-2.1": "LGPL-2.1", "usr/share/common-licenses/GPL-3": "GPL-3"}
REPOSITORY = "https://github.com/haywirephoenix/webos-localvoice"
ICON = "https://raw.githubusercontent.com/haywirephoenix/webos-localvoice/main/app/largeIcon.png"
PAGES = "https://haywirephoenix.github.io/webos-localvoice/"
SUMMARY = "Speech recognition that runs on the TV, for the remote's microphone button and apps with their own"
UBUNTU_LIBS = ["ld-linux-armhf.so.3", "libc.so.6", "libm.so.6", "libdl.so.2", "libpthread.so.0", "librt.so.1",
               "libgcc_s.so.1", "libstdc++.so.6"]
SHERPA_LIBS = ["libonnxruntime.so", "libsherpa-onnx-c-api.so"]
MODEL_FILES = ["encoder_model.ort", "decoder_model_merged.ort", "tokens.txt", "LICENSE"]
EXECUTABLE = ("init/ctl.sh", "init/boot.sh")


def fetch(name):
    url, want = SOURCES[name]
    target = CACHE / (name if name in LICENCES else url.rsplit("/", 1)[1])
    if not target.exists():
        print("downloading " + url)
        CACHE.mkdir(exist_ok=True)
        with urllib.request.urlopen(url) as r:
            target.write_bytes(r.read())
    got = hashlib.sha256(target.read_bytes()).hexdigest()
    if got != want:
        target.unlink()
        sys.exit("checksum mismatch for %s: %s" % (target.name, got))
    return target


def members(archive):
    """Every file of an archive as {path without its leading ./: member}."""
    return {m.name.lstrip("./"): m for m in archive.getmembers()}


def ubuntu_lib(tar, index, name):
    """A library by its soname, following the links of a merged /usr."""
    path = next(n for n in index if n.endswith("/" + name))
    for _ in range(10):
        m = index.get(path) or index.get("usr/" + path) or index.get(path[4:])
        if m is None:
            break
        if m.issym():
            path = posixpath.normpath(posixpath.join(posixpath.dirname(m.name.lstrip("./")), m.linkname)).lstrip("/")
        elif m.islnk():
            path = m.linkname.lstrip("./")
        else:
            return tar.extractfile(m).read()
    sys.exit("missing " + name)


def runtime_files():
    """(path under runtime/, bytes, mode) for the engine, its libraries and the model."""
    exe = 0o755
    files = []
    with tarfile.open(fetch("sherpa")) as tar:
        index = members(tar)
        for name in SHERPA_LIBS:
            found = next(n for n in index if n.endswith("/lib/" + name))
            files.append(("lib/" + name, tar.extractfile(index[found]).read(), 0o644))
    with tarfile.open(fetch("ubuntu")) as tar:
        index = members(tar)
        for name in UBUNTU_LIBS:
            mode = exe if name.startswith("ld-") else 0o644
            files.append(("lib/" + name, ubuntu_lib(tar, index, name), mode))
        for path, name in UBUNTU_LICENCES.items():
            files.append(("licences/" + name, tar.extractfile(index[path]).read(), 0o644))
    with tarfile.open(fetch("model")) as tar:
        index = members(tar)
        for name in MODEL_FILES:
            files.append(("model/" + name, tar.extractfile(index[MODEL_DIR + "/" + name]).read(), 0o644))
    for name in LICENCES:
        files.append(("licences/" + name, fetch(name).read_bytes(), 0o644))
    files.append(("licences/THIRD-PARTY.md", (ROOT / "THIRD-PARTY.md").read_bytes().replace(b"\r\n", b"\n"), 0o644))
    files.append(("bin/lvengine", compile_engine(dict((f[0], f[1]) for f in files)), exe))
    return files


def compile_engine(files):
    """Builds lvengine in .cache, against the libraries of the pinned release."""
    work = CACHE / "native"
    include = work / "sherpa-onnx" / "c-api"
    include.mkdir(parents=True, exist_ok=True)
    (include / "c-api.h").write_bytes(fetch("header").read_bytes())
    for name in SHERPA_LIBS:
        (work / name).write_bytes(files["lib/" + name])
    out = work / "lvengine"
    cmd = [sys.executable, "-m", "ziglang", "cc", "-target", "arm-linux-gnueabihf.2.28", "-mcpu=cortex_a7", "-O2", "-s",
           "-Wall", "-I" + str(work), str(ROOT / "native/lvengine.c"), str(work / "libsherpa-onnx-c-api.so"),
           "-Wl,--allow-shlib-undefined", "-o", str(out)]
    subprocess.run(cmd, check=True)
    return out.read_bytes()


def tgz(files):
    """A gzip tar of (path, bytes, mode), with its directories."""
    buf = io.BytesIO()
    now = int(time.time())
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as tar:
        dirs = set()
        for name, data, mode in files:
            parts = name.split("/")[:-1]
            for i in range(1, len(parts) + 1):
                d = "/".join(parts[:i])
                if d not in dirs:
                    dirs.add(d)
                    info = tarfile.TarInfo("./" + d)
                    info.type, info.mode, info.mtime = tarfile.DIRTYPE, 0o755, now
                    tar.addfile(info)
            info = tarfile.TarInfo("./" + name)
            info.size, info.mode, info.mtime = len(data), mode, now
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def ar(members_):
    out = b"!<arch>\n"
    for name, data in members_:
        header = name.ljust(16) + "0".ljust(12) + "0".ljust(6) + "0".ljust(6) + "100644".ljust(8) + str(len(data)).ljust(10) + "`\n"
        out += header.encode() + data + (b"\n" if len(data) % 2 else b"")
    return out


def app_files(folder="app"):
    """(path in the app, bytes, mode) for everything under a folder. Text is packed with LF."""
    files = []
    base = ROOT / folder
    for p in sorted(base.rglob("*")):
        if p.is_file():
            rel = p.relative_to(base).as_posix()
            data = p.read_bytes()
            if p.suffix != ".png":
                data = data.replace(b"\r\n", b"\n")
            files.append((rel, data, 0o755 if rel in EXECUTABLE else 0o644))
    return files


def package(app, version, files, description):
    """An IPK of one app, and its installed size."""
    prefix = "usr/palm/applications/%s/" % app
    data = [(prefix + n, d, m) for n, d, m in files]
    data.append(("usr/palm/packages/%s/packageinfo.json" % app,
                 json.dumps({"id": app, "version": version, "app": app}, indent=1).encode(), 0o644))
    size = sum(len(f[1]) for f in data)
    control = ("Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\nInstalled-Size: %d\n"
               "Maintainer: haywire\nDescription: %s\n" % (app, version, size, description)).encode()
    return ar([("debian-binary", b"2.0\n"), ("control.tar.gz", tgz([("control", control, 0o644)])), ("data.tar.gz", tgz(data))]), size


def repository(version, ipk_name, ipk):
    """The release's manifest, as Homebrew Channel reads it, and the repository that lists it."""
    manifest = {"id": APP, "version": version, "type": "web", "title": "Local Voice", "appDescription": SUMMARY,
                "iconUri": ICON, "sourceUrl": REPOSITORY, "rootRequired": True,
                "ipkUrl": "%s/releases/download/v%s/%s" % (REPOSITORY, version, ipk_name),
                "ipkHash": {"sha256": hashlib.sha256(ipk).hexdigest()}}
    package = {"id": APP, "title": "Local Voice", "iconUri": ICON, "shortDescription": SUMMARY, "pool": "main",
               "fullDescriptionUrl": PAGES + "full_description.html",
               "manifestUrl": "%s/releases/download/v%s/%s.manifest.json" % (REPOSITORY, version, APP), "manifest": manifest}
    paging = {"page": 1, "count": 1, "maxPage": 1, "itemsTotal": 1, "itemsPerPage": 1}
    return manifest, {"paging": paging, "packages": [package]}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(ROOT / "dist"))
    parser.add_argument("--sources", action="store_true")
    args = parser.parse_args()
    info = json.loads((ROOT / "app/appinfo.json").read_text())
    version = info["version"]
    card_files = app_files("card") + [("icon.png", (ROOT / "app/icon.png").read_bytes(), 0o644)]
    card, _ = package(CARD, version, card_files, "The status card of Local Voice")
    files = app_files() + [("runtime/" + n, d, m) for n, d, m in runtime_files()]
    files += [("card/card.ipk", card, 0o644), ("card/version", ('"version": "%s"' % version).encode(), 0o644)]
    ipk, size = package(APP, version, files, "Speech recognition that runs on the TV")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    target = out / ("%s_%s_all.ipk" % (APP, version))
    target.write_bytes(ipk)
    print("%s: %.1f MB, %.1f MB installed" % (target, len(ipk) / 1e6, size / 1e6))
    manifest, repo = repository(version, target.name, ipk)
    (out / (APP + ".manifest.json")).write_bytes((json.dumps(manifest, indent=2) + "\n").encode())
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs/apps.json").write_bytes((json.dumps(repo, indent=2) + "\n").encode())
    if args.sources:
        (out / "sources").mkdir(exist_ok=True)
        for name in LIBRARY_SOURCES:
            shutil.copy(fetch(name), out / "sources")


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
