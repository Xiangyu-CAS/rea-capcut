#!/usr/bin/env bash
# Build offline Windows x64 media tools with MinGW-w64 and no third-party runtime DLLs.
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
downloads="$root/.media-build/downloads"
output="$root/media-tools/win32-x64"
case "$(uname -s)" in
  Linux) cross=x86_64-w64-mingw32- ;;
  *) [[ "${MSYSTEM:-}" == UCRT64 ]] || { echo 'Use Linux with MinGW-w64 or the MSYS2 UCRT64 shell.' >&2; exit 1; }
     cross= ;;
esac
jobs="${BUILD_JOBS:-$(nproc)}"
mkdir -p "$downloads" "$(dirname "$output")"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
prefix="$work/prefix"
stage="$work/media-tools"
mkdir -p "$prefix/include" "$prefix/lib" "$stage/sources" "$stage/licenses"
unset CFLAGS CPPFLAGS CXXFLAGS LDFLAGS
export PKG_CONFIG_PATH=
export PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig"

download() {
  local url="$1" file="$2" sha="$3"
  if ! (cd "$downloads" && sha256sum --check --status <<< "$sha  $file"); then
    curl --fail --location --retry 3 --proto '=https' "$url" -o "$downloads/$file.partial"
    (cd "$downloads" && sha256sum --check <<< "$sha  $file.partial")
    mv -f -- "$downloads/$file.partial" "$downloads/$file"
  fi
  cp -- "$downloads/$file" "$stage/sources/"
  tar -xf "$downloads/$file" -C "$work"
  printf '%s  %s\n' "$sha" "$file" >> "$stage/sources/SHA256SUMS.txt"
  printf '%s  %s\n' "$file" "$url" >> "$stage/sources/URLS.txt"
}

x264=b35605ace3ddf7c1a5d67a2eb553f034aef41d55
download "https://code.videolan.org/videolan/x264/-/archive/$x264/x264-$x264.tar.gz" \
  x264-b35605ac.tar.gz cd71a7515b0e9a012e1ac9b1f8415bebcaf6fc97d4db32286642ac4c0fbe24f9
download https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz \
  ffmpeg-9.0.2.tar.xz 8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
download https://zlib.net/fossils/zlib-1.4.tar.gz \
  zlib-1.4.tar.gz 02dd159783677a749c04adbdd02b55b8a2bcc7e054f51b76b549199a916ad584

cd "$work/zlib-1.4"
make -j "$jobs" -f win32/Makefile.gcc PREFIX="$cross" libz.a
cp zlib.h zconf.h "$prefix/include/"
cp libz.a "$prefix/lib/"
cp LICENSE "$stage/licenses/zlib-LICENSE"

cd "$work/x264-$x264"
./configure --prefix="$prefix" --host=x86_64-w64-mingw32 --cross-prefix="$cross" \
  --enable-static --disable-cli --disable-opencl
make -j "$jobs"
make install-lib-static
cp COPYING "$stage/licenses/x264-COPYING"

cd "$work/ffmpeg-9.0.2"
cross_flags=()
if [[ -n "$cross" ]]; then cross_flags=(--enable-cross-compile "--cross-prefix=$cross"); fi
./configure --target-os=mingw32 --arch=x86_64 "${cross_flags[@]}" \
  --enable-static --disable-shared --disable-autodetect --enable-gpl \
  --enable-libx264 --enable-zlib --disable-pthreads --enable-w32threads \
  --disable-network --disable-protocols --enable-protocol=file,pipe \
  --disable-devices --enable-indev=lavfi --disable-ffplay --disable-doc --disable-debug \
  --pkg-config=pkg-config --pkg-config-flags=--static \
  "--extra-cflags=-I$prefix/include" "--extra-ldflags=-L$prefix/lib -static"
make -j "$jobs" ffmpeg.exe ffprobe.exe
for tool in ffmpeg ffprobe; do
  "${cross}strip" -o "$stage/$tool.exe" "$tool.exe"
  "${cross}objdump" -p "$stage/$tool.exe" | awk '/DLL Name:/ {print tolower($3)}' > "$stage/$tool.dlls.txt"
  # The system CRT is either MSVCRT (cross compiler) or UCRT (MSYS2).
  if grep -Eiv '^(api-ms-win-crt-[a-z0-9-]+|advapi32|bcrypt|comdlg32|crypt32|gdi32|kernel32|msvcrt|ole32|oleaut32|psapi|secur32|shell32|ucrtbase|user32|version|winmm|ws2_32)\.dll$' "$stage/$tool.dlls.txt"; then
    echo "Unexpected runtime DLL dependency in $tool.exe" >&2
    exit 1
  fi
done
for license in COPYING.GPLv2 COPYING.GPLv3 COPYING.LGPLv2.1 COPYING.LGPLv3 LICENSE.md; do
  cp "$license" "$stage/licenses/FFmpeg-$license"
done
cp "$root/scripts/build-windows-media-tools.sh" "$stage/sources/"
printf 'FFmpeg/FFprobe with x264 are GPL-2.0-or-later. zlib retains its own license.\nThe source archives are unmodified. See licenses/, sources/SHA256SUMS.txt and sources/URLS.txt.\nTo rebuild, place the source tarballs in .media-build/downloads and the recipe in scripts/ under the same parent, then run the recipe.\nOn Debian/Ubuntu install gcc-mingw-w64-x86-64-win32, binutils-mingw-w64-x86-64, make, nasm, pkg-config, curl and xz-utils.\nIn MSYS2 use UCRT64 with make, diffutils, pkgconf, mingw-w64-ucrt-x86_64-gcc and mingw-w64-ucrt-x86_64-nasm.\n' > "$stage/README.txt"
(
  cd "$stage"
  sha256sum ffmpeg.exe ffprobe.exe > SHA256SUMS.txt
)
mkdir -p "$output"
cp -R "$stage/." "$output/"
printf 'Windows media tools ready: %s\n' "$output"
