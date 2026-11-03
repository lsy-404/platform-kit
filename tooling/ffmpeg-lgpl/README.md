# @platform-kit/ffmpeg-lgpl

LGPL-2.1-or-later FFmpeg 9.0.2 `ffmpeg` executable for audio work: decoding common audio/video containers to PCM and encoding AAC in m4a. Only the `ffmpeg` program is built (no ffplay/ffprobe), without GPL or non-free components and without external libraries. Video decoders and network protocols are not included; use `-vn`.

Targets: `darwin-arm64`, `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`. Layout: `bin/<platform>-<arch>/ffmpeg` (`ffmpeg.exe` on Windows).

```js
const { ffmpegPath } = require("@platform-kit/ffmpeg-lgpl");
const ffmpeg = ffmpegPath(); // absolute path for process.platform / process.arch
```

`ffmpegPath(platform, arch)` throws for an unsupported target. Inside an asar archive, unpack `node_modules/@platform-kit/ffmpeg-lgpl/bin/**` so the binary can be executed.

Capabilities: file and pipe protocols; mov/mp4/m4a, mp3, wav/w64, aiff, caf, flac, aac, ogg, matroska/webm, avi, asf/wma, flv, mpeg-ps/ts, ac3/eac3 and amr demuxers; aac, mp1/mp2/mp3, opus, vorbis, flac, alac, wma, ac3/eac3, amr and PCM/ADPCM decoders; aac and PCM encoders; ipod/mp4/wav/raw PCM muxers; `aresample`, `aformat`, `atrim` filters.

Local-Whisper style decode and cloud upload compression:

```sh
ffmpeg -y -i input -vn -ac 1 -ar 16000 -f f32le out.f32
ffmpeg -y -i input -vn -ac 1 -ar 16000 -c:a aac -b:a 48k out.m4a
```

## Build and release

`.github/workflows/ffmpeg-lgpl.yml` builds each target on a native runner, verifies it (`-L`, `-buildconf`, dependency rules, encode/decode smoke test) and, for a `ffmpeg-lgpl-v*` tag, publishes `platform-kit-ffmpeg-lgpl-<version>.tgz`, `SHA256SUMS` and `ffmpeg-9.0.2.tar.xz` to a GitHub Release. The FFmpeg source URL, checksum and flags are in [NOTICE](NOTICE); `build/` holds the build and verification scripts.

Platform minimums: macOS 13, Windows system UCRT, Linux static (musl).

## License

LGPL-2.1-or-later; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
