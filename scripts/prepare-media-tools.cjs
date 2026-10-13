// electron-builder runs this before collecting files, including direct CLI builds.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
exports.default = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  const architecture = { 1: 'x64', 3: 'arm64' }[context.arch];
  if (process.platform !== 'darwin' || architecture !== process.arch)
    throw new Error('Build the macOS installer on a matching native architecture for bundled media tools.');
  execFileSync(process.execPath, [path.join(context.packager.projectDir, 'scripts/build-media-tools.mjs')], { stdio: 'inherit' });
};
