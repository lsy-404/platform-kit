"use strict";

const path = require("node:path");

const TARGETS = new Set(["darwin-arm64", "win32-x64", "win32-arm64", "linux-x64", "linux-arm64"]);

function ffmpegPath(platform = process.platform, arch = process.arch) {
  const target = `${platform}-${arch}`;
  if (!TARGETS.has(target)) {
    throw new Error(`@platform-kit/ffmpeg-lgpl has no binary for ${target}; supported: ${[...TARGETS].join(", ")}`);
  }
  return path.join(__dirname, "bin", target, platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
}

module.exports = { ffmpegPath };
