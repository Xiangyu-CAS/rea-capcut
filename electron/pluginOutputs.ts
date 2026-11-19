import { link, lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";

/** Scope stays in main and is granted by a native folder picker for this session. */
export async function pluginOutputFolder(selected: string) {
  const directory = await realpath(selected);
  const initial = await stat(directory);
  if (!initial.isDirectory()) throw new Error("Choose an output folder.");
  const verify = async () => {
    const current = await lstat(directory).catch(() => null);
    if (!current?.isDirectory() || current.dev !== initial.dev || current.ino !== initial.ino ||
        await realpath(directory) !== directory)
      throw new Error("The output folder changed. Select it again.");
  };
  return {
    directory,
    async destination(name: unknown, extension: "reacut" | "mp4" | "mov") {
      if (typeof name !== "string" || !name || name.trim() !== name ||
          Buffer.byteLength(name) > 180 || name.endsWith(".") ||
          /\.(reacut|mp4|mov)$/i.test(name) ||
          /[<>:"/\\|?*\u0000-\u001f\u007f]/u.test(name) ||
          /^(con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\s*\.|$)/i.test(name))
        throw new Error("Use a plain output filename without an extension or path separators.");
      const file = path.join(directory, `${name}.${extension}`);
      await verify();
      try {
        await lstat(file);
        throw new Error("Output already exists. Choose a different name.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      return {
        path: file, verify,
        async publish(temporary: string) {
          await verify();
          // Unlike rename, link atomically refuses existing files, including a late collision.
          try { await link(temporary, file); }
          catch (error) {
            switch ((error as NodeJS.ErrnoException).code) {
              case "EEXIST": throw new Error("Output already exists. Choose a different name.");
              case "ENOTSUP":
              case "EXDEV":
              case "EPERM": throw new Error("This folder does not support safe creation of new output files.");
              default: throw error;
            }
          }
        },
      };
    },
  };
}

export type PluginOutputFolder = Awaited<ReturnType<typeof pluginOutputFolder>>;
