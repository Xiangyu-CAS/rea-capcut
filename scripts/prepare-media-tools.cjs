// electron-builder runs this before collecting files, including direct CLI builds.
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
exports.default = async context => {
  if (context.electronPlatformName === 'win32') {
    if (context.arch !== 1 || process.platform !== 'win32' || process.arch !== 'x64')
      throw new Error('Build the Windows x64 installer with x64 Node.js on Windows.');
    const media = path.join(context.packager.projectDir, 'media-tools/win32-x64');
    try {
      for (const folder of [media, path.join(media, 'sources')]) {
        const manifest = (await fs.readFile(path.join(folder, 'SHA256SUMS.txt'), 'utf8')).split(/\r?\n/);
        const required = folder === media ? ['ffmpeg.exe', 'ffprobe.exe']
          : ['x264-b35605ac.tar.gz', 'ffmpeg-9.0.2.tar.xz', 'zlib-1.4.tar.gz'];
        for (const name of required) {
          const hash = createHash('sha256').update(await fs.readFile(path.join(folder, name))).digest('hex');
          if (!manifest.includes(`${hash}  ${name}`) && !manifest.includes(`${hash} *${name}`))
            throw new Error(`Checksum mismatch: ${name}`);
        }
      }
      for (const file of ['sources/build-windows-media-tools.sh', 'licenses/FFmpeg-COPYING.GPLv2', 'licenses/x264-COPYING', 'licenses/zlib-LICENSE']) {
        await fs.access(path.join(media, file));
      }
    } catch (error) {
      throw new Error(`Prepare the Windows media bundle with scripts/build-windows-media-tools.sh before packaging. ${error.message}`, { cause: error });
    }
    return;
  }
  if (context.electronPlatformName !== 'darwin') return;
  const architecture = { 1: 'x64', 3: 'arm64' }[context.arch];
  if (process.platform !== 'darwin' || architecture !== process.arch)
    throw new Error('Build the macOS installer on a matching native architecture for bundled media tools.');
  execFileSync(process.execPath, [path.join(context.packager.projectDir, 'scripts/build-media-tools.mjs')], { stdio: 'inherit' });
};
