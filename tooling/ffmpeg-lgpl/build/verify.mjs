import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const bin = process.argv[2];
const here = dirname(fileURLToPath(import.meta.url));
const run = (args) => execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const runBuffer = (args) => {
  const result = spawnSync(bin, args, { maxBuffer: 256 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
};

const license = run(["-L"]);
assert.match(license, /GNU Lesser General Public License/);
assert.doesNotMatch(license, /GNU General Public License(?! v)|nonfree/i);

const buildconf = run(["-buildconf"]);
assert.doesNotMatch(buildconf, /--enable-(gpl|nonfree|version3)/);
for (const flag of readFileSync(join(here, "configure.args"), "utf8").split(/\r?\n/).filter(Boolean)) {
  assert.ok(buildconf.includes(flag), `buildconf is missing ${flag}`);
}

const dir = mkdtempSync(join(tmpdir(), "ffmpeg-lgpl-"));
const rate = 44100;
const seconds = 2;
const samples = rate * seconds;
const wav = Buffer.alloc(44 + samples * 4);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + samples * 4, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(samples * 4, 40);
for (let i = 0; i < samples; i++) {
  const value = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000);
  wav.writeInt16LE(value, 44 + i * 4);
  wav.writeInt16LE(value, 46 + i * 4);
}
const wavPath = join(dir, "in.wav");
const m4aPath = join(dir, "out.m4a");
writeFileSync(wavPath, wav);

run(["-y", "-i", wavPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "48k", m4aPath]);
const pcm = runBuffer(["-v", "error", "-i", m4aPath, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"]);
const expected = 16000 * 4 * seconds;
assert.ok(pcm.length > expected * 0.95 && pcm.length < expected * 1.1, `decoded ${pcm.length} bytes, expected about ${expected}`);
let peak = 0;
for (let i = 0; i + 4 <= pcm.length; i += 4) peak = Math.max(peak, Math.abs(pcm.readFloatLE(i)));
assert.ok(peak > 0.1, "decoded audio is silent");

const limited = runBuffer(["-v", "error", "-i", wavPath, "-t", "1", "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"]);
assert.ok(Math.abs(limited.length - 16000 * 4) < 16000 * 4 * 0.05, `limited decode produced ${limited.length} bytes`);

console.log("ffmpeg-lgpl verification passed");
