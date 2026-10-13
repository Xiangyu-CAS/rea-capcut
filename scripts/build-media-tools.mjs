/** Build self-contained macOS media tools from pinned, unmodified upstream sources. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch))
  throw new Error('This media-tool recipe requires a native macOS arm64 or x64 build host.');
const target = `darwin-${process.arch}`;
const work = path.join(root, '.media-build', target);
const downloads = path.join(root, '.media-build', 'downloads');
const output = path.join(root, 'media-tools', target);
const prefix = path.join(work, 'prefix');
const sources = [
  {
    name: 'ffmpeg', version: '9.0.2', file: 'ffmpeg-9.0.2.tar.xz',
    url: 'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz',
    sha256: '8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e',
    directory: 'ffmpeg-9.0.2',
  },
  {
    name: 'x264', version: 'b35605ace3ddf7c1a5d67a2eb553f034aef41d55', file: 'x264-b35605ac.tar.gz',
    url: 'https://code.videolan.org/videolan/x264/-/archive/b35605ace3ddf7c1a5d67a2eb553f034aef41d55/x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.gz',
    sha256: 'cd71a7515b0e9a012e1ac9b1f8415bebcaf6fc97d4db32286642ac4c0fbe24f9',
    directory: 'x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55',
  },
  {
    name: 'pkgconf', version: '3.0.8', file: 'pkgconf-3.0.8.tar.xz',
    url: 'https://distfiles.ariadne.space/pkgconf/pkgconf-3.0.8.tar.xz',
    sha256: '943f0bc88bcaeceb630b00262e2a8ad5ea4fac3fba72a4267d8b9ec6b35d1194',
    directory: 'pkgconf-3.0.8', buildOnly: true,
  },
];
const digest = data => createHash('sha256').update(data).digest('hex');
const hashFile = async file => digest(await fs.readFile(file));
const recipeHash = await hashFile(fileURLToPath(import.meta.url));
function run(command, args, cwd = root, env = process.env, capture = false) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result.stdout ?? '';
}
function systemLibrariesOnly(file) {
  const libraries = run('/usr/bin/otool', ['-L', file], root, process.env, true)
    .split('\n').slice(1).map(line => line.trim().split(' (')[0]).filter(Boolean);
  if (!libraries.length || libraries.some(lib => !lib.startsWith('/usr/lib/') && !lib.startsWith('/System/Library/')))
    throw new Error(`Non-system runtime dependency in ${file}: ${libraries.join(', ')}`);
  return libraries;
}
try {
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
  if (manifest.recipeSHA256 === recipeHash && manifest.target === target) {
    for (const tool of manifest.tools) {
      const file = path.join(output, tool.name);
      if (await hashFile(file) !== tool.buildSHA256) throw new Error('Cached tool digest changed');
      systemLibrariesOnly(file);
    }
    for (const source of sources)
      if (await hashFile(path.join(output, 'sources', source.file)) !== source.sha256) throw new Error('Cached source digest changed');
    console.log(`Verified cached media tools: ${output}`);
    process.exit(0);
  }
} catch { /* Missing/stale generated output is rebuilt from verified sources. */ }
await fs.mkdir(downloads, { recursive: true });
await fs.mkdir(work, { recursive: true });
for (const source of sources) {
  const file = path.join(downloads, source.file);
  let valid = false;
  try { valid = await hashFile(file) === source.sha256; } catch { /* download */ }
  if (!valid) {
    const temporary = file + '.partial';
    run('/usr/bin/curl', ['--fail', '--location', '--retry', '2', '--proto', '=https', source.url, '-o', temporary]);
    if (await hashFile(temporary) !== source.sha256) throw new Error(`Source checksum mismatch: ${source.name}`);
    await fs.rename(temporary, file);
  }
  const destination = path.join(work, source.directory);
  await fs.rm(destination, { recursive: true, force: true });
  run('/usr/bin/tar', ['-xf', file, '-C', work]);
}
const jobs = String(Math.min(8, os.availableParallelism()));
const env = { ...process.env, MACOSX_DEPLOYMENT_TARGET: '12.0', PKG_CONFIG_PATH: path.join(prefix, 'lib/pkgconfig'), PKG_CONFIG_LIBDIR: path.join(prefix, 'lib/pkgconfig'), PKG_CONFIG_ALLOW_SYSTEM_CFLAGS: '1', PKG_CONFIG_ALLOW_SYSTEM_LIBS: '1' };
delete env.CFLAGS; delete env.LDFLAGS; delete env.CPPFLAGS;
const configs = {};
configs.pkgconf = [`--prefix=${prefix}`, '--disable-shared', '--enable-static'];
configs.x264 = [`--prefix=${prefix}`, '--enable-static', '--enable-pic', '--disable-cli', '--disable-opencl', '--extra-cflags=-mmacosx-version-min=12.0', ...(process.arch === 'x64' ? ['--disable-asm'] : [])];
configs.ffmpeg = [
  `--prefix=${prefix}`, '--cc=clang', '--enable-static', '--disable-shared',
  '--disable-autodetect', '--enable-gpl', '--enable-libx264', '--enable-zlib',
  '--enable-pthreads', '--enable-videotoolbox', '--enable-audiotoolbox',
  '--disable-network', '--disable-protocols', '--enable-protocol=file,pipe',
  '--disable-devices', '--enable-indev=lavfi', '--disable-ffplay', '--disable-doc', '--disable-debug',
  `--pkg-config=${path.join(prefix, 'bin/pkgconf')}`, '--pkg-config-flags=--static',
  '--extra-cflags=-mmacosx-version-min=12.0', '--extra-ldflags=-mmacosx-version-min=12.0',
];
for (const name of ['pkgconf', 'x264', 'ffmpeg']) {
  const source = sources.find(item => item.name === name);
  const cwd = path.join(work, source.directory);
  console.log(`Building ${name} for ${target}…`);
  run('./configure', configs[name], cwd, env);
  run('/usr/bin/make', ['-j', jobs], cwd, env);
  run('/usr/bin/make', ['install'], cwd, env);
}
await fs.mkdir(path.join(output, 'sources'), { recursive: true });
await fs.mkdir(path.join(output, 'licenses'), { recursive: true });
const tools = [];
for (const name of ['ffmpeg', 'ffprobe']) {
  const file = path.join(output, name);
  await fs.copyFile(path.join(prefix, 'bin', name), file);
  await fs.chmod(file, 0o755);
  const libraries = systemLibrariesOnly(file);
  const version = run(file, ['-version'], root, env, true).split('\n')[0];
  tools.push({ name, version, buildSHA256: await hashFile(file), libraries });
}
for (const source of sources) await fs.copyFile(path.join(downloads, source.file), path.join(output, 'sources', source.file));
const ffSource = path.join(work, sources[0].directory);
for (const name of ['COPYING.GPLv2', 'COPYING.GPLv3', 'COPYING.LGPLv2.1', 'COPYING.LGPLv3', 'LICENSE.md'])
  await fs.copyFile(path.join(ffSource, name), path.join(output, 'licenses', `FFmpeg-${name}`));
await fs.copyFile(path.join(work, sources[1].directory, 'COPYING'), path.join(output, 'licenses', 'x264-COPYING'));
await fs.copyFile(fileURLToPath(import.meta.url), path.join(output, 'sources', 'build-media-tools.mjs'));
await fs.writeFile(path.join(output, 'sources', 'README.txt'), 'Corresponding source for the bundled FFmpeg/FFprobe executables. FFmpeg and x264 sources are unmodified. Extract the source archives or place them in .media-build/downloads of the ReaCut repository and run node scripts/build-media-tools.mjs on macOS with Xcode command line tools and Node.js 24.11+ or 26+. pkgconf is a build-only tool and its source is also provided. Configure arguments are in manifest.json; recipe placeholders/paths are resolved at build time. GPL-2.0-or-later applies to this FFmpeg+x264 build. The original ReaCut code is separately licensed under MIT. Package signing may change executable bytes after the buildSHA256 values are recorded.\n');
const scrub = value => value.replaceAll(prefix, '$BUILD_PREFIX');
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({
  target, builtAt: new Date().toISOString(), recipeSHA256: recipeHash,
  license: 'GPL-2.0-or-later', sourceModifications: 'none', deploymentTarget: '12.0',
  compiler: run('/usr/bin/clang', ['--version'], root, env, true).split('\n')[0],
  configure: Object.fromEntries(Object.entries(configs).map(([name, args]) => [name, args.map(scrub)])),
  sources, tools,
}, null, 2) + '\n');
console.log(`Self-contained media tools ready: ${output}`);
