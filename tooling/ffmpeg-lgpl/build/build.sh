#!/usr/bin/env bash
# usage: build.sh <target> <output-dir>
set -euo pipefail

target="$1"
out="$(mkdir -p "$2" && cd "$2" && pwd)"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$here/source.env"

work="$(mktemp -d)"
curl -fsSL --retry 3 -o "$work/ffmpeg.tar.xz" "$FFMPEG_URL"
echo "$FFMPEG_SHA256  $work/ffmpeg.tar.xz" | sha256sum -c -
cp "$work/ffmpeg.tar.xz" "$out/ffmpeg-$FFMPEG_VERSION.tar.xz"
tar -xJf "$work/ffmpeg.tar.xz" -C "$work"
common=()
while IFS= read -r line; do
  [ -z "$line" ] || common+=("$line")
done < <(tr -d "" < "$here/configure.args")

exe=ffmpeg
extra=()
case "$target" in
  darwin-*)
    export MACOSX_DEPLOYMENT_TARGET=13.0
    extra=(--enable-pthreads --extra-cflags=-mmacosx-version-min=13.0 --extra-ldflags=-mmacosx-version-min=13.0)
    ;;
  linux-*)
    extra=(--enable-pthreads --extra-ldflags=-static)
    ;;
  win32-x64)
    exe=ffmpeg.exe
    extra=(--target-os=mingw32 --extra-ldflags=-static)
    ;;
  win32-arm64)
    exe=ffmpeg.exe
    extra=(--target-os=mingw32 --arch=aarch64 --cc=clang --extra-ldflags=-static)
    ;;
  *) echo "unsupported target $target" >&2; exit 1 ;;
esac

cd "$work/ffmpeg-$FFMPEG_VERSION"
./configure "${common[@]}" "${extra[@]}" || { tail -50 ffbuild/config.log; exit 1; }
make -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"

strip_tool=strip
command -v strip >/dev/null || strip_tool=llvm-strip
mkdir -p "$out/bin"
cp "$exe" "$out/bin/$exe"
if [ "${target%%-*}" = darwin ]; then "$strip_tool" -x "$out/bin/$exe"; else "$strip_tool" "$out/bin/$exe"; fi
