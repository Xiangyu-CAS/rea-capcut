export type MediaKind = "video" | "audio" | "image";
export type TrackKind = MediaKind | "text";
export interface MediaAsset {
  id: string;
  name: string;
  path: string;
  url: string;
  kind: MediaKind;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  thumbnail?: string;
  waveform?: number[];
  missing?: boolean;
  previewUrl?: string;
  previewError?: string;
}
export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  flipX: boolean;
  flipY: boolean;
}
export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  blur: number;
}
export interface TextStyle {
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  background: string;
  align: "left" | "center" | "right";
  bold: boolean;
  stroke: string;
  strokeWidth: number;
}
export interface Keyframe {
  id: string;
  time: number;
  property: "x" | "y" | "scale" | "rotation" | "opacity" | "volume";
  value: number;
  easing: "linear" | "easeInOut";
  easingWindow?: { start: number; end: number };
}
export interface FadeWindow {
  offset: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
}
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ChromaKey {
  enabled: boolean;
  color: string;
  similarity: number;
  blend: number;
}
export interface ShapeMask {
  shape: "rectangle" | "ellipse";
  width: number;
  height: number;
  feather: number;
  invert: boolean;
}
export interface Clip {
  id: string;
  trackId: string;
  assetId?: string;
  name: string;
  start: number;
  duration: number;
  sourceIn: number;
  speed: number;
  volume: number;
  muted: boolean;
  transform: Transform;
  adjustments: Adjustments;
  text?: TextStyle;
  fadeIn: number;
  fadeOut: number;
  audioFadeIn: number;
  audioFadeOut: number;
  videoFadeWindow?: FadeWindow;
  audioFadeWindow?: FadeWindow;
  keyframes: Keyframe[];
  crop?: CropRect;
  chromaKey?: ChromaKey;
  mask?: ShapeMask;
}
export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
}
export interface Project {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
  assets: MediaAsset[];
  tracks: Track[];
  clips: Clip[];
  createdAt: string;
  updatedAt: string;
}
export interface ExportOptions {
  path: string;
  width: number;
  height: number;
  fps: number;
  quality: "draft" | "standard" | "high";
  format: "mp4" | "mov";
}
export interface ExportProgress {
  jobId: string;
  progress: number;
  status: "preparing" | "rendering" | "complete" | "error" | "cancelled";
  message?: string;
  path?: string;
}
export interface AppSettings {
  ffmpegPath?: string;
  ffprobePath?: string;
  language: "zh" | "en";
  autosave: boolean;
}
export interface RecentProject {
  path: string;
  name: string;
  updatedAt: string;
}
export interface EditorAPI {
  importMedia: (paths?: string[]) => Promise<MediaAsset[]>;
  relinkAsset: (asset: MediaAsset) => Promise<MediaAsset | null>;
  onMenuAction: (callback: (action: string) => void) => () => void;
  setDirty: (dirty: boolean) => void;
  cancelCloseRequest: () => void;
  closeWindow: () => void;
  chooseMediaTool: (name: "ffmpeg" | "ffprobe") => Promise<string | null>;
  getFontFamilies: () => Promise<string[]>;
  getStartupProject: () => Promise<{ project: Project; path: string } | null>;
  openProject: () => Promise<{ project: Project; path: string } | null>;
  saveProject: (project: Project, path?: string) => Promise<string | null>;
  autosaveProject: (project: Project) => Promise<void>;
  getAutosave: () => Promise<Project | null>;
  getRecentProjects: () => Promise<RecentProject[]>;
  openRecentProject: (
    path: string,
  ) => Promise<{ project: Project; path: string }>;
  chooseExportPath: (
    name: string,
    format: "mp4" | "mov",
  ) => Promise<string | null>;
  exportProject: (
    project: Project,
    options: ExportOptions,
  ) => Promise<{ jobId: string }>;
  cancelExport: (jobId: string) => Promise<void>;
  onExportProgress: (callback: (event: ExportProgress) => void) => () => void;
  getSystemInfo: () => Promise<{
    version: string;
    platform: string;
    ffmpeg: boolean;
    ffmpegVersion?: string;
    ffmpegPath?: string;
  }>;
  readTextFile: (
    extensions: string[],
  ) => Promise<{ text: string; name: string } | null>;
  writeTextFile: (text: string, name: string) => Promise<string | null>;
  revealPath: (path: string) => Promise<void>;
  getPathForFile: (file: File) => string;
}
declare global {
  interface Window {
    editorAPI?: EditorAPI;
  }
}
