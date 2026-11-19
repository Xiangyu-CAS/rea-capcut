import { duckingEnvelope } from "../src/core/audioMix";
import { fadeWindow } from "../src/core/model";
import type { Clip, Track } from "../src/core/types";
import { keyframeExpression, number } from "./filterExpressions";

function tempoFilters(speed: number): string[] {
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 0.000001)
    filters.push(`atempo=${number(remaining)}`);
  return filters;
}

export function sourceAudioFilters(clip: Clip): string[] {
  return [
    `atrim=start=0:duration=${number(clip.duration * clip.speed)}`,
    "asetpts=PTS-STARTPTS",
    ...tempoFilters(clip.speed),
    "aresample=48000",
    "aformat=sample_fmts=fltp:channel_layouts=stereo",
    `atrim=duration=${number(clip.duration)}`,
  ];
}

export function clipAudioFilters(clip: Clip): string[] {
  const filters = sourceAudioFilters(clip);
  const volume = keyframeExpression(clip, "volume", clip.volume);
  filters.push(`volume='${volume}':eval=frame`);
  if (clip.audioGainDb) filters.push(`volume=${number(clip.audioGainDb)}dB`);
  const fade = fadeWindow(clip, "audio");
  const fadeOffset =
    fade.fadeIn > 0 || fade.fadeOut > 0 ? Math.max(0, fade.offset) : 0;
  const fadeDelay = Math.max(0, -fade.offset);
  if (fadeOffset > 0)
    filters.push(`asetpts=PTS+${number(fadeOffset)}/TB`);
  if (fade.fadeIn > 0)
    filters.push(
      `afade=t=in:st=${number(fadeDelay)}:d=${number(fade.fadeIn)}`,
    );
  if (fade.fadeOut > 0)
    filters.push(
      `afade=t=out:st=${number(fade.duration - fade.fadeOut + fadeDelay)}:d=${number(fade.fadeOut)}`,
    );
  if (fadeOffset > 0)
    filters.push(`asetpts=PTS-${number(fadeOffset)}/TB`);
  return filters;
}

export function trackDuckingFilter(track: Track): string | undefined {
  if (!track.audioDucking) return;
  const { attack, release, gain, regions } = duckingEnvelope(track.audioDucking);
  // A balanced expression keeps FFmpeg's expression nesting bounded for long edits.
  const tree = (first: number, last: number): string => {
    if (first > last) return "1";
    const mid = Math.floor((first + last) / 2);
    const { start, end } = regions[mid];
    const lead = number(start - attack), tail = number(end + release);
    const down = `1-${number(1 - gain)}*(t-(${lead}))/${number(attack)}`;
    const up = `${number(gain)}+${number(1 - gain)}*(t-${number(end)})/${number(release)}`;
    return `if(lt(t,${lead}),${tree(first, mid - 1)},if(lt(t,${tail}),if(lt(t,${number(start)}),${down},if(lt(t,${number(end)}),${number(gain)},${up})),${tree(mid + 1, last)}))`;
  };
  return `asetnsamples=n=480:p=0,volume='${tree(0, regions.length - 1)}':eval=frame`;
}
