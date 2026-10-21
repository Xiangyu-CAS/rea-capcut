import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { derivativePlan } from '../src/core/derivativeEdits';
import type { DerivativeProgress, DerivativeRequest, MediaAsset, Project } from '../src/core/types';
import { importAssets, probeFile, runMediaTool } from './media';

const jobs = new Map<string, { controller: AbortController; done: Promise<MediaAsset> }>();
export function cancelDerivative(id: string) { jobs.get(id)?.controller.abort(); }
export async function cancelDerivatives() { for (const job of jobs.values()) job.controller.abort(); await Promise.allSettled([...jobs.values()].map(j => j.done)); }
const number = (n: number) => Number(n.toFixed(9)).toString();
function tempo(speed: number): string[] {
  const result: string[] = [];
  while (speed > 2) { result.push('atempo=2'); speed /= 2; }
  while (speed < .5) { result.push('atempo=0.5'); speed /= .5; }
  return [...result, `atempo=${number(speed)}`];
}

export function deriveMedia(jobId: string, p: Project, clipId: string, request: DerivativeRequest, directory: string,
  progress: (e: DerivativeProgress) => void): Promise<MediaAsset> {
  if (typeof jobId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(jobId)) throw new Error('无效任务编号');
  if (jobs.size) throw new Error('已有媒体处理任务，请等待或取消');
  const plan = derivativePlan(p, clipId, request), controller = new AbortController();
  const done = Promise.resolve().then(generate).finally(() => jobs.delete(jobId));
  jobs.set(jobId, { controller, done });
  return done;
  async function generate(): Promise<MediaAsset> {
    const { signal } = controller, { clip, asset, frames, time } = plan;
    const report = (value: number, message: string) => { signal.throwIfAborted(); progress({ jobId, progress: value, message }); };
    let temporary: string | undefined;
    const run = async (args: string[], base: number, span: number, seconds: number, message: string) => {
      let buffer = '';
      await runMediaTool('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-progress', 'pipe:1', '-threads', '2', ...args], 60 * 60_000, 16 * 1024 * 1024, {
        signal, onOutput: text => {
          buffer += text;
          const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
          for (const line of lines) if (line.startsWith('out_time_us=')) {
            const value = Number(line.split('=')[1]);
            if (Number.isFinite(value) && !signal.aborted) progress({ jobId, progress: base + span * Math.min(1, Math.max(0, value / 1e6 / seconds)), message });
          }
        },
      });
    };
    try {
      report(0, '检查源素材');
      const info = await stat(asset.path), probe = await probeFile(asset.path, signal);
      signal.throwIfAborted();
      const v = probe.streams.find(s => s.codec_type === 'video');
      const width = v?.width ?? 0, height = v?.height ?? 0;
      const [sarN, sarD] = (v?.sample_aspect_ratio ?? '1:1').split(':').map(Number);
      const sar = sarN > 0 && sarD > 0 ? sarN / sarD : 1;
      const displayWidth = Math.ceil(width * sar);
      const pixelBudget = Math.max(width * height, displayWidth * height);
      if (!width || !height || !Number.isFinite(pixelBudget) || pixelBudget > 4096 * 2160 || Math.max(width, height, displayWidth) > 8192) throw new Error('当前衍生媒体支持最高 4096×2160 像素量，请先缩小素材');
      const sourceDuration = (Number(v?.duration) || Number(probe.format.duration));
      if (!Number.isFinite(sourceDuration) || clip.sourceIn + clip.duration * clip.speed > sourceDuration + .05) throw new Error('片段超出实际源素材时长');
      const sourceTime = clip.sourceIn + (time - clip.start) * clip.speed;
      const audio = request.mode === 'reverse' && request.audio === 'reverse' && probe.streams.some(s => s.codec_type === 'audio');
      const key = createHash('sha256').update(JSON.stringify(['derivative-v2', asset.path, info.size, info.mtimeMs, request.mode,
        request.mode === 'freeze' ? sourceTime : [clip.sourceIn, clip.duration, clip.speed, audio], p.fps])).digest('hex');
      await mkdir(directory, { recursive: true });
      const destination = path.join(directory, key + (request.mode === 'freeze' ? '.png' : '.mp4'));
      let cached = false;
      try { await access(destination); cached = true; } catch { /* Create below. */ }
      if (!cached) {
        temporary = await mkdtemp(path.join(directory, '.processing-'));
        const result = path.join(temporary, request.mode === 'freeze' ? 'result.png' : 'result.mp4');
        if (request.mode === 'freeze') {
          // Retain the source frame preceding the requested timestamp, exactly like export sampling.
          await run(['-ss', number(sourceTime), '-noaccurate_seek', '-i', asset.path,
            '-vf', `fps=${p.fps}:round=up:start_time=0,scale=w=ceil(iw*sar):h=ih,setsar=1`, '-frames:v', '1', '-an', result], 0, .9, 1 / p.fps, '提取播放头静帧');
        } else {
          // Normalize speed/PTS once. Compressed disk intermediates avoid buffering the entire clip in RAM.
          const forward = path.join(temporary, 'forward.nut');
          await run(['-ss', number(clip.sourceIn), '-noaccurate_seek', '-i', asset.path,
            '-map', '0:v:0', ...(audio ? ['-map', '0:a:0'] : ['-an']),
            '-vf', `trim=end=${number(clip.duration * clip.speed)},setpts=PTS/${number(clip.speed)},fps=${p.fps}:round=up:start_time=0,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${frames},scale=w=ceil(iw*sar/2)*2:h=ceil(ih/2)*2,setsar=1`,
            ...(audio ? ['-af', [`atrim=start=0:duration=${number(clip.duration * clip.speed)}`, 'asetpts=PTS-STARTPTS', ...tempo(clip.speed), 'apad', `atrim=duration=${number(clip.duration)}`].join(','), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2'] : []),
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-t', number(clip.duration), forward], 0, .4, clip.duration, '准备倒放素材');
          // At most 96 MiB of decoded RGBA-equivalent frames, and at most 2 seconds per block.
          const block = Math.max(1, Math.min(Math.floor(p.fps * 2), Math.floor(96 * 1024 * 1024 / (pixelBudget * 4))));
          const chunks: { file: string; duration: number }[] = []; const count = Math.ceil(frames / block);
          for (let to = frames; to > 0;) {
            const from = Math.max(0, to - block), length = (to - from) / p.fps;
            const file = `part-${chunks.length}.nut`;
            report(.4 + .5 * chunks.length / count, `倒放分段 ${chunks.length + 1}/${count}`);
            await run(['-ss', number(from / p.fps), '-i', forward,
              '-map', '0:v:0', ...(audio ? ['-map', '0:a:0'] : ['-an']),
              '-vf', `trim=end_frame=${to - from},reverse,setpts=N/(${p.fps}*TB)`,
              ...(audio ? ['-af', `atrim=duration=${number(length)},areverse,asetpts=PTS-STARTPTS`, '-c:a', 'pcm_s16le'] : []),
              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-t', number(length), path.join(temporary, file)],
              .4 + .5 * chunks.length / count, .5 / count, length, '倒放分段');
            chunks.push({ file, duration: length }); to = from;
          }
          await writeFile(path.join(temporary, 'concat.txt'), chunks.map(chunk => `file '${chunk.file}'\nduration ${number(chunk.duration)}`).join('\n'));
          await run(['-f', 'concat', '-safe', '1', '-i', path.join(temporary, 'concat.txt'), '-c:v', 'copy',
            ...(audio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']), '-t', number(clip.duration), '-movflags', '+faststart', result], .9, .05, clip.duration, '合并倒放素材');
        }
        signal.throwIfAborted();
        const after = await stat(asset.path);
        if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('源素材在处理期间发生变化，请重试');
        await rename(result, destination);
      }
      report(.95, cached ? '复用已生成素材' : '载入衍生素材');
      const [derived] = await importAssets([destination], path.join(path.dirname(directory), 'thumbnails'), signal);
      signal.throwIfAborted();
      derived.name = asset.name + (request.mode === 'reverse' ? ' · 倒放' : ' · 定格');
      report(1, '处理完成');
      return derived;
    } catch (error) { if (signal.aborted) throw new Error('已取消处理'); throw error; }
    finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
  }
}
