import { createClip, createProject, createTrack } from "../core/model";
import type { MediaAsset, TrackKind } from "../core/types";
import { translateUI } from "../i18n/uiTranslation";

/** Localize only newly generated defaults. Saved/imported names and text are
 * user content and must never change when the interface language changes. */
export function createEditorTrack(kind: TrackKind, name?: string) {
  const labels: Record<TrackKind, [string, string]> = {
    video: ["视频", "Video"], image: ["画面", "Image"],
    audio: ["音频", "Audio"], text: ["文字", "Text"],
  };
  return createTrack(kind, name ?? translateUI(...labels[kind]));
}
export function createEditorProject() {
  const project = createProject(translateUI("未命名项目", "Untitled project"));
  project.tracks = [createEditorTrack("text"), createEditorTrack("video", translateUI("视频 1", "Video 1")), createEditorTrack("audio", translateUI("音频 1", "Audio 1"))];
  return project;
}
export function createEditorClip(asset: MediaAsset | undefined, trackId: string, start: number, fps: number) {
  const clip = createClip(asset, trackId, start, fps);
  if (!asset && clip.text) {
    clip.name = translateUI("默认文本", "Default text");
    clip.text.text = translateUI("在这里输入文字", "Enter text here");
  }
  return clip;
}
