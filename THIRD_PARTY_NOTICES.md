# Third-party attribution

ReaCut's original source code is licensed under MIT, in `LICENSE`. Dependencies retain their own licenses and attribution. This file records the installed versions used for the local build; `package-lock.json` pins JavaScript packages and `licenses/manifest.json` records collected notice sources.

| Component | Installed version | Attribution |
| --- | --- | --- |
| React / React DOM | 19.3.0 | MIT; Meta Platforms, Inc. and affiliates |
| Scheduler | 0.28.0 | MIT; Meta Platforms, Inc. and affiliates |
| Zustand | 5.0.15 | MIT; see the original package LICENSE |
| Lucide React | 0.468.0 | ISC; Lucide contributors, with Feather-derived portions credited in its LICENSE |
| `@napi-rs/canvas` | 1.0.11 | MIT wrapper; Yinan Long / package copyright notice |
| `@napi-rs/canvas-darwin-arm64` | 1.0.11 | Native Skia binding; upstream SBOM retained, components have additional licenses |
| Noto Sans SC variable TTF | Git blob `fb0637bafbcd804fe32152370a1225990745b4bc` | SIL OFL 1.1; Copyright 2014–2021 Adobe, Reserved Font Name “Source”; unmodified official google/fonts asset |
| Electron | 44.7.0 | MIT for Electron; Chromium, Node.js and bundled components retain separate notices |
| React TypeScript declarations / csstype | 19.3.0 / 3.2.3 | MIT; attribution retained conservatively even though these declarations are not executable runtime code |

Original npm license texts are copied from the installed packages into `licenses/`. Electron's distribution `LICENSE` and complete `LICENSES.chromium.html` are retained. The packaged Electron runtime also supplies its own notices; do not remove them when redistributing an application build.

## Native canvas and Skia

The native canvas package ships `sbom.cdx.json`. Its 107-component inventory includes the native binary itself, Cargo dependencies and pinned Skia external dependencies; some records may describe build-time rather than runtime components. ReaCut retains that unmodified SBOM and conservatively collects attribution for its library records.

The canvas wrapper's MIT license does not replace these native licenses. They include MIT, Apache-2.0, BSD, ISC, MPL-2.0, Unicode, FreeType, ICU, libpng, IJG and Zlib terms, including multi-license expressions preserved in the SBOM. Skia's pinned submodule for canvas 1.0.11 is `95ee33d7ec7791ab9c071675710a14fe6408ae4f`; its original LICENSE and external component notices are retained under `licenses/native/`.

Portions of this software are copyright © 1996–2002, 2006 The FreeType Project (www.freetype.org). All rights reserved.

This product uses FreeType as part of its native canvas dependency. FreeType Project attribution and the complete FreeType License are retained in the corresponding native notice directory. Upstream source locations are recorded beside the notices and in the manifest, including exact crate releases and pinned repository revisions for source-available components. The application does not modify these upstream native libraries.

## Collecting and preserving notices

```sh
npx tsx scripts/licenses.ts
```

The default command copies installed npm/Electron notices, reads already collected native notices, writes a manifest and SHA-256 inventory, and reports missing records with a failing exit status. It does not download source code. To collect native attribution from exact upstream releases and pinned commits, use the optional online pass (requires `curl`):

```sh
npx tsx scripts/licenses.ts --fetch-native
```

The online pass reads bounded crate archives in memory and writes only license/notice texts; it does not extract or distribute dependency source code. It obtains native Git notices from pinned upstream repositories. `licenses/manifest.json` lists unresolved records if any source fails. Preserve `LICENSE`, this document, `licenses/`, and Electron's distribution notices in redistributed builds. A successful notice collection reflects the installed platform package; regenerate and inspect attribution after changing dependencies or building for another platform.

## Bundled font

The default Chinese-capable font is the unmodified Noto Sans SC variable TTF from [google/fonts](https://github.com/google/fonts/tree/main/ofl/notosanssc). `public/fonts/OFL.txt` retains its exact upstream copyright and SIL Open Font License 1.1 text; `public/fonts/PROVENANCE.json` records source URLs, byte sizes, Git blob IDs and SHA-256 digests. The collector verifies both content digests and Git blob identities before copying the OFL and provenance into `licenses/fonts/NotoSansSC/`.

The font remains under OFL 1.1 and is not relicensed as MIT. No glyphs, names, binaries or copyright notices have been modified. The application can also use fonts installed by the user; those system fonts are not bundled or redistributed.

## External programs and research tools

FFmpeg and FFprobe are separately installed executables. ReaCut invokes them as subprocesses and does not bundle their binaries, shared libraries or source. The user's installed FFmpeg build has its own upstream and optional codec licenses. This repository does not redistribute that build.

REA is a development research tool from [morluto/rea](https://github.com/morluto/rea). Its tools are not imported, copied into the runtime, or required to run ReaCut. The public research report distinguishes observed behavior from inference and original design. Raw local evidence remains excluded from the repository.

No Jianying / CapCut proprietary application code, libraries, fonts, templates, icons, paid materials or other assets are included. The bundled Noto Sans SC is an openly licensed third-party font; optional installed system fonts are used at runtime and are not redistributed. Generated test media are produced by this repository's fixture generator; users retain responsibility for the media they import.
