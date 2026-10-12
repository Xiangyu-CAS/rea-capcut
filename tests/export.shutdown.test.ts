import { expect, it } from "vitest";
import { runMediaTool, shutdownMediaTasks } from "../electron/media";

it("drains an owned media process and prevents new workers during app shutdown", async () => {
  const work = runMediaTool("ffmpeg", [
    "-v",
    "error",
    "-re",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "60",
    "-f",
    "null",
    "-",
  ]).then(
    () => undefined,
    (error) => error,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const started = performance.now();
  await shutdownMediaTasks();
  expect(await work).toBeInstanceOf(Error);
  expect(performance.now() - started).toBeLessThan(5000);
  await expect(runMediaTool("ffprobe", ["-version"])).rejects.toThrow(
    "应用正在关闭",
  );
}, 10_000);
