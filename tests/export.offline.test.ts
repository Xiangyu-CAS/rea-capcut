import { expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { probeFile, runMediaTool } from "../electron/media";

it("never fetches network segments embedded in a local imported playlist", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server did not bind");
  const directory = await mkdtemp(path.join(tmpdir(), "reacut-offline-"));
  try {
    const file = path.join(directory, "local.m3u8");
    await writeFile(
      file,
      `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:1.0,\nhttp://127.0.0.1:${address.port}/segment.ts\n#EXT-X-ENDLIST\n`,
    );
    await expect(probeFile(file)).rejects.toThrow(
      /whitelist|Protocol|Invalid data/,
    );
    await expect(
      runMediaTool("ffmpeg", [
        "-v",
        "error",
        "-i",
        file,
        "-frames:v",
        "1",
        "-f",
        "null",
        "-",
      ]),
    ).rejects.toThrow(/whitelist|Protocol|Invalid data/);
    expect(requests).toBe(0);
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 10_000);
