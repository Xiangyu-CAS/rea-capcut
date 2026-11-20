import { speedSegments } from "../src/core/speedCurve";
import type { Clip } from "../src/core/types";
import { number } from "./filterExpressions";

export function videoTimeFilter(clip: Clip, preservePts: boolean, still = false): string {
  if (!clip.speedCurve || still)
    return `setpts=${preservePts ? "PTS" : "(PTS-STARTPTS)"}/${still ? "1" : number(clip.speed)}`;
  const time = preservePts ? "T" : "((PTS-STARTPTS)*TB)";
  const segments = speedSegments(clip);
  const outputTime = segments.reduceRight((fallback, segment) => {
    const delta = `(${time}-${number(segment.sourceStart)})`;
    const at = `${number(segment.start)}+2*${delta}/(${number(segment.rate)}+sqrt(max(0,${number(segment.rate ** 2)}+(${number(2 * segment.slope)})*${delta})))`;
    return `if(lte(${time},${number(segment.sourceEnd)}),${at},${fallback})`;
  }, `${number(clip.duration)}+(${time}-${number(clip.duration * clip.speed)})/${number(clip.speedCurve.at(-1)!.rate)}`);
  return `settb=AVTB,setpts='if(lt(${time},0),${time}/${number(clip.speedCurve[0].rate)},${outputTime})/TB'`;
}
