import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

type ToolName = "ffmpeg" | "ffprobe";
let bundledDirectory: string | undefined;

/** The packaged main process supplies this before media work begins. */
export function setBundledMediaToolsDirectory(directory: string): void {
  bundledDirectory = directory;
}

export async function resolveMediaTool(
  name: ToolName,
  options: {
    bundledDirectory?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
  } = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const override = env[name === "ffmpeg" ? "REACUT_FFMPEG" : "REACUT_FFPROBE"];
  const windows = platform === "win32";
  const executable = windows ? `${name}.exe` : name;
  // Worker threads use a case-sensitive copy of the Windows environment.
  const searchPath = env.PATH ?? (windows ? env.Path : undefined) ?? "";
  const candidates = override
    ? [override]
    : options.bundledDirectory
      ? [path.join(options.bundledDirectory, executable)]
      : searchPath.split(windows ? ";" : ":")
          .filter(Boolean).map(directory => path.join(directory, executable))
          .concat(windows ? [] : [
            `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`,
          ]);
  for (const candidate of candidates) {
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, windows ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch { /* next candidate */ }
  }
  if (override) throw new Error(`所选 ${name} 不可用，请在设置中重新选择可执行文件。`);
  if (options.bundledDirectory)
    throw new Error(`内置 ${name} 缺失或不可执行，请重新安装完整应用。`);
  throw new Error(`找不到 ${name}。开发环境请安装 FFmpeg，或在设置中选择可执行文件。`);
}

export function findMediaTool(name: ToolName): Promise<string> {
  return resolveMediaTool(name, { bundledDirectory });
}
