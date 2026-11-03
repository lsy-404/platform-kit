#!/usr/bin/env bash
# usage: deps-check.sh <target> <binary>
set -euo pipefail

target="$1"
bin="$2"

case "$target" in
  darwin-*)
    otool -L "$bin"
    bad="$(otool -L "$bin" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/usr/lib/|/System/Library/)' || true)"
    [ -z "$bad" ] || { echo "non-system libraries: $bad" >&2; exit 1; }
    minos="$(otool -l "$bin" | awk '/LC_BUILD_VERSION/{f=1} f&&/minos/{print $2; exit}')"
    echo "minos $minos"
    [ "$(printf '%s\n13.0\n' "$minos" | sort -V | tail -1)" = "13.0" ] || { echo "deployment target above 13.0" >&2; exit 1; }
    ;;
  linux-*)
    file "$bin"
    file "$bin" | grep -q 'statically linked'
    if ldd "$bin" 2>&1 | grep -qv 'not a dynamic executable\|statically linked'; then echo "ldd reports dynamic dependencies" >&2; ldd "$bin" || true; exit 1; fi
    ;;
  win32-*)
    dlls="$(objdump -p "$bin" | awk '/DLL Name:/{print tolower($3)}')"
    echo "$dlls"
    if echo "$dlls" | grep -Eq '^(libgcc|libwinpthread|libstdc|libc\+\+|libunwind|msys|libmingw)'; then echo "runtime DLL dependency" >&2; exit 1; fi
    for dll in $dlls; do
      if [ -n "${MINGW_PREFIX:-}" ] && [ -e "$MINGW_PREFIX/bin/$dll" ]; then echo "$dll comes from the MSYS2 prefix" >&2; exit 1; fi
    done
    ;;
  *) echo "unsupported target $target" >&2; exit 1 ;;
esac
