import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

/** Copy attribution data only. --fetch-native obtains pinned native dependency notice texts. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "licenses");
const remote = process.argv.includes("--fetch-native");
interface Entry {
  directory: string;
  name: string;
  version: string;
  license?: unknown;
  source: string;
  files: string[];
}
const entries: Entry[] = [];
const issues: string[] = [];
const safe = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_");
async function json(file: string) {
  return JSON.parse(await readFile(file, "utf8"));
}
async function keep(
  directory: string,
  name: string,
  bytes: Uint8Array | string,
) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, safe(name)), bytes);
}
async function request(url: string): Promise<Buffer> {
  const { stdout } = await promisify(execFile)(
    "curl",
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--max-time",
      "20",
      url,
    ],
    { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
  );
  return Buffer.from(stdout);
}
const noticeFile = (name: string) =>
  /^(license|licence|copying|copyright|notice|authors)([._-]|$)/i.test(
    path.basename(name),
  );
async function localPackage(name: string): Promise<void> {
  const directory = path.join(root, "node_modules", name);
  let p;
  try {
    p = await json(path.join(directory, "package.json"));
  } catch {
    return;
  }
  const destination = path.join(output, `${safe(name)}-${p.version}`),
    files: string[] = [];
  for (const file of await readdir(directory))
    if (noticeFile(file)) {
      try {
        await keep(
          destination,
          file,
          await readFile(path.join(directory, file)),
        );
        files.push(safe(file));
      } catch {
        /* Directory notices are handled by native SBOM below. */
      }
    }
  for (const file of ["sbom.cdx.json"])
    try {
      await keep(destination, file, await readFile(path.join(directory, file)));
      files.push(file);
    } catch {
      /* Only native canvas packages provide an SBOM. */
    }
  entries.push({
    directory: path.relative(output, destination).replace(/\\/g, "/"),
    name,
    version: p.version,
    license: p.license,
    source: `installed npm package ${name}@${p.version}`,
    files,
  });
  if (name === "electron")
    for (const file of ["LICENSE", "LICENSES.chromium.html"]) {
      try {
        await keep(
          destination,
          file,
          await readFile(path.join(directory, "dist", file)),
        );
        if (!files.includes(file)) files.push(file);
      } catch {
        issues.push(`Missing Electron distribution notice ${file}`);
      }
    }
}
const names = new Set<string>([
  "@modelcontextprotocol/ext-apps",
  "@modelcontextprotocol/sdk",
  "zod",
  "zod-to-json-schema",
  "react",
  "react-dom",
  "scheduler",
  "zustand",
  "lucide-react",
  "@napi-rs/canvas",
  "electron",
  "@types/react",
  "csstype",
]);
const canvas = await json(
  path.join(root, "node_modules/@napi-rs/canvas/package.json"),
);
for (const name of Object.keys(canvas.optionalDependencies ?? {}))
  names.add(name);
await mkdir(output, { recursive: true });
for (const name of names) await localPackage(name);

/** Read tar file headers without extracting executable code or following archive paths. */
function tarNotices(archive: Buffer, metadata = false): Map<string, Buffer> {
  const data = gunzipSync(archive, { maxOutputLength: 64 * 1024 * 1024 }),
    files = new Map<string, Buffer>();
  for (let at = 0; at + 512 <= data.length;) {
    const header = data.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString().split("\0")[0],
      size =
        parseInt(
          header.subarray(124, 136).toString().replace(/\0/g, "").trim(),
          8,
        ) || 0;
    const body = data.subarray(at + 512, at + 512 + size);
    if (
      (noticeFile(name) ||
        (metadata &&
          [".cargo_vcs_info.json", "Cargo.toml", "Cargo.toml.orig"].includes(
            path.basename(name),
          ))) &&
      size <= 2 * 1024 * 1024 &&
      (header[156] === 0 || header[156] === 48)
    )
      files.set(safe(name.replace(/^[^/]+\//, "")), body);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
const native = entries.filter((e) => e.name.startsWith("@napi-rs/canvas-"));
const seen = new Set<string>();
for (const binary of native) {
  const sbom = await json(
    path.join(root, "node_modules", binary.name, "sbom.cdx.json"),
  );
  for (const component of sbom.components ?? []) {
    const key = `${component.name}@${component.version}`;
    if (component.type === "file" || seen.has(key)) continue;
    seen.add(key);
    if (component.name === "canvas") {
      entries.push({
        directory: `${safe("@napi-rs/canvas")}-${canvas.version}`,
        name: "native-canvas",
        version: canvas.version,
        license: "MIT",
        source: `${binary.name} SBOM project component; use parent @napi-rs/canvas LICENSE`,
        files: ["LICENSE"],
      });
      continue;
    }
    const directory = path.join(output, "native", safe(key)),
      files: string[] = [];
    const entry: Entry = {
      directory: path.relative(output, directory).replace(/\\/g, "/"),
      name: component.name,
      version: component.version,
      license: component.licenses,
      source: component.purl ?? key,
      files,
    };
    entries.push(entry);
    try {
      for (const name of await readdir(directory)) files.push(name);
    } catch {
      /* first collection */
    }
    if (files.length) {
      try {
        entry.source = await readFile(
          path.join(directory, "SOURCE_URLS.txt"),
          "utf8",
        );
      } catch {}
      continue;
    }
    if (!remote) {
      try {
        for (const name of await readdir(directory)) files.push(name);
      } catch {
        issues.push(`Native notice not collected: ${key}; run --fetch-native`);
      }
      continue;
    }
    try {
      if (component.purl?.startsWith("pkg:cargo/")) {
        if (
          !/^[a-zA-Z0-9_-]+$/.test(component.name) ||
          !/^[a-zA-Z0-9.+_-]+$/.test(component.version)
        )
          throw new Error("Invalid crate identity");
        const url = `https://static.crates.io/crates/${component.name}/${component.name}-${component.version}.crate`;
        entry.source = url;
        const archive = await request(url),
          expected = component.hashes?.find(
            (h: { alg: string }) => h.alg === "SHA-256",
          )?.content;
        if (
          expected &&
          createHash("sha256").update(archive).digest("hex") !== expected
        )
          throw new Error("Crate checksum disagrees with native SBOM");
        const sourceFiles = tarNotices(archive, true);
        for (const [name, data] of sourceFiles)
          if (noticeFile(name)) {
            await keep(directory, name, data);
            files.push(name);
          }
        // Some workspace crates omit the repository-wide LICENSE from their published archive.
        if (!files.length) {
          const vcs = JSON.parse(
            sourceFiles.get(".cargo_vcs_info.json")?.toString() ?? "{}",
          );
          const toml =
            (sourceFiles.get("Cargo.toml.orig")?.toString() ?? "") +
            "\n" +
            (sourceFiles.get("Cargo.toml")?.toString() ?? "");
          const repository = toml.match(/^repository\s*=\s*"([^"\n]+)"/m)?.[1];
          if (
            repository &&
            /^https:\/\/github\.com\/(napi-rs\/napi-rs|Nugine\/simd)$/.test(
              repository,
            ) &&
            /^[a-f0-9]{40}$/.test(vcs.git?.sha1 ?? "")
          ) {
            const source = `https://raw.githubusercontent.com/${repository.slice("https://github.com/".length)}/${vcs.git.sha1}/LICENSE`;
            await keep(directory, "LICENSE", await request(source));
            files.push("LICENSE");
            entry.source += "\n" + source;
          }
        }
      } else {
        const repository = component.properties?.find(
          (p: { name: string }) => p.name === "cdx:skia:repositoryUrl",
        )?.value;
        if (
          !repository ||
          !["chromium.googlesource.com", "skia.googlesource.com"].includes(
            new URL(repository).hostname,
          ) ||
          !/[a-f0-9]{40}/.test(component.version)
        )
          throw new Error("Unknown pinned native repository");
        const candidates: Record<string, string[]> = {
          expat: ["COPYING", "expat/COPYING"],
          freetype: ["docs/FTL.TXT", "LICENSE.TXT"],
          brotli: ["LICENSE"],
          harfbuzz: ["COPYING"],
          icu: ["LICENSE"],
          libjxl: ["LICENSE", "PATENTS"],
          highway: ["LICENSE", "LICENSE-BSD3", "PATENTS"],
          "libjpeg-turbo": ["LICENSE.md", "README.ijg"],
          libpng: ["LICENSE"],
          libwebp: ["COPYING", "PATENTS"],
          wuffs: ["LICENSE"],
          zlib: ["LICENSE"],
        };
        const sources: string[] = [];
        for (const file of candidates[component.name] ?? [
          "LICENSE",
          "COPYING",
        ]) {
          const url = `${repository}/+/${component.version}/${file}?format=TEXT`;
          try {
            const data = Buffer.from(
              (await request(url)).toString().trim(),
              "base64",
            );
            if (data.length < 30) continue;
            await keep(directory, file, data);
            files.push(safe(file));
            sources.push(url);
          } catch {
            /* Different native repositories use different notice file names. */
          }
        }
        entry.source = sources.join("\n") || repository;
      }
      if (files.length)
        await keep(directory, "SOURCE_URLS.txt", entry.source + "\n");
      if (!files.length) issues.push(`No notice files collected for ${key}`);
    } catch (error) {
      issues.push(`${key}: ${String(error)}`);
    }
  }
}
// Canvas 1.0.11 pins this Skia commit in its git submodule. No application source is copied.
const skiaDirectory = path.join(
  output,
  "native",
  "skia-95ee33d7ec7791ab9c071675710a14fe6408ae4f",
);
const skiaEntry: Entry = {
  directory: path.relative(output, skiaDirectory).replace(/\\/g, "/"),
  name: "skia",
  version: "95ee33d7ec7791ab9c071675710a14fe6408ae4f",
  license: "BSD-3-Clause",
  source:
    "https://github.com/google/skia/tree/95ee33d7ec7791ab9c071675710a14fe6408ae4f",
  files: [],
};
entries.push(skiaEntry);
if (canvas.version !== "1.0.11")
  issues.push(
    "Canvas version changed; verify Skia submodule pin before distributing.",
  );
for (const file of ["LICENSE"])
  try {
    if (remote)
      await keep(
        skiaDirectory,
        file,
        await request(
          `https://raw.githubusercontent.com/google/skia/${skiaEntry.version}/${file}`,
        ),
      );
    await readFile(path.join(skiaDirectory, file));
    skiaEntry.files.push(file);
  } catch {
    issues.push(`Missing Skia ${file}; run --fetch-native`);
  }
const fontSource = path.join(root, "public/fonts"),
  fontDestination = path.join(output, "fonts", "NotoSansSC");
try {
  const provenance = await json(path.join(fontSource, "PROVENANCE.json"));
  for (const name of ["NotoSansSC.ttf", "OFL.txt"]) {
    const record = provenance.files.find(
      (entry: { file: string }) => entry.file === name,
    );
    const data = await readFile(path.join(fontSource, name));
    if (
      !record ||
      data.length !== record.bytes ||
      createHash("sha256").update(data).digest("hex") !== record.sha256
    )
      throw new Error(`Font provenance SHA-256 disagrees with ${name}`);
    const gitDigest = createHash("sha1")
      .update(Buffer.from(`blob ${data.length}\0`))
      .update(data)
      .digest("hex");
    if (gitDigest !== record.gitBlobSha1)
      throw new Error(`Font provenance Git blob disagrees with ${name}`);
  }
  for (const name of ["OFL.txt", "PROVENANCE.json"])
    await keep(
      fontDestination,
      name,
      await readFile(path.join(fontSource, name)),
    );
  entries.push({
    directory: "fonts/NotoSansSC",
    name: "Noto Sans SC",
    version: provenance.files.find(
      (entry: { file: string }) => entry.file === "NotoSansSC.ttf",
    ).gitBlobSha1,
    license: "OFL-1.1",
    source: provenance.files
      .map((entry: { source: string }) => entry.source)
      .join("\n"),
    files: ["OFL.txt", "PROVENANCE.json"],
  });
} catch (error) {
  issues.push(`Bundled font attribution: ${String(error)}`);
}
const manifest = {
  formatVersion: 1,
  scope:
    "Installed runtime npm packages, Electron distribution notices, installed native canvas SBOM components and bundled unmodified Noto Sans SC. Build tooling is not bundled. SBOM may include build-only native crates.",
  entries,
  issues,
};
await keep(output, "manifest.json", JSON.stringify(manifest, null, 2) + "\n");
const hashes: string[] = [];
async function hash(directory: string) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) await hash(file);
    else if (item.name !== "SHA256SUMS")
      hashes.push(
        `${createHash("sha256")
          .update(await readFile(file))
          .digest("hex")}  ${path.relative(output, file).replace(/\\/g, "/")}`,
      );
  }
}
await hash(output);
await keep(output, "SHA256SUMS", hashes.sort().join("\n") + "\n");
console.log(
  `Collected attribution records: ${entries.length}; unresolved: ${issues.length}`,
);
if (issues.length) {
  console.warn(issues.join("\n"));
  process.exitCode = 1;
}
