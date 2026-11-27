# Online music test fixture

`online-music-tone.mp3` is a generated four-second 440 Hz tone, not music from the provider. The test serves it in place of a remote track so it runs offline and needs only a shipped MP3 decoder. To regenerate with a development FFmpeg build that includes libmp3lame:

```sh
ffmpeg -y -v error -f lavfi -i sine=frequency=440:duration=4 -ar 24000 -ac 1 -c:a libmp3lame -b:a 32k -map_metadata -1 tests/fixtures/online-music-tone.mp3
```
