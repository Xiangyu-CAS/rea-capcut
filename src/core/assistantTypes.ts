import type { SpeechRecognitionRequest } from "./speech";
import type { Subtitle } from "./subtitles";
import type { Project } from "./types";

export type AssistantCLI = "codex" | "claude";
export type AssistantProvider = AssistantCLI | "codex-agent";
export type CodexAgentAccount = "connected" | "signed-out";
export interface CodexAgentModel {
  id: string;
  label: string;
  isDefault: boolean;
  acceptsImages: boolean;
  efforts: string[];
  defaultEffort?: string;
}
export const CODEX_EDITING_EFFORTS = ["none", "minimal", "light", "low", "medium", "high", "xhigh", "max"] as const;
export interface CodexAgentSelection { model: string; effort?: string }

export const MAX_ASSISTANT_REFERENCES = 3;
export const MAX_ASSISTANT_REFERENCE_BYTES = 256 * 1024;
export const MAX_ASSISTANT_MEDIA = 20;
export const MAX_ASSISTANT_COMMENTARY = 8;
export const MAX_ASSISTANT_COMMENTARY_LENGTH = 1200;
export const MAX_ASSISTANT_WORK_ENTRIES = 24;
export const ASSISTANT_ACTIVITY_KINDS = ["source", "transcription", "translation", "captions", "edit", "preview", "plan"] as const;
export type AssistantActivityKind = typeof ASSISTANT_ACTIVITY_KINDS[number];
export type AssistantWorkEntry =
  | { type: "note"; text: string }
  | { type: "activity"; kind: AssistantActivityKind; text: string; state: "active" | "done" | "stopped" };
export interface AssistantReference { assetId: string; dataUrl: string }
export interface AssistantMediaSelection {
  assetId: string;
  range?: { sourceIn: number; duration: number };
}

export interface AssistantLocalProject {
  project: Project;
  playhead: number;
  media: AssistantMediaSelection[];
}

export interface AssistantTranscription {
  id: string;
  request: SpeechRecognitionRequest;
  time: number;
  cues: Subtitle[];
}

export type AssistantAction =
  | { type: "addText"; text: string; start: number; duration: number; fontSize?: number; color?: string; x?: number; y?: number }
  | { type: "addCaptions"; transcriptionId: string; translations?: string[] }
  | { type: "transcribe"; source: string }
  | { type: "addAsset"; assetId: string; start: number; trackId?: string; sourceIn?: number; duration?: number }
  | { type: "trimClip"; clipId: string; edge: "start" | "end"; time: number }
  | { type: "splitClip"; clipId: string; time: number }
  | { type: "deleteClip"; clipId: string }
  | { type: "moveClip"; clipId: string; start: number; trackId?: string }
  | { type: "setSpeed"; clipId: string; speed: number }
  | { type: "setVolume"; clipId: string; volume: number; muted?: boolean }
  | { type: "setText"; clipId: string; text: string }
  | { type: "setTransform"; clipId: string; x?: number; y?: number; scale?: number; rotation?: number; opacity?: number }
  | { type: "setFades"; clipId: string; fadeIn: number; fadeOut: number; audioFadeIn: number; audioFadeOut: number }
  | { type: "setProject"; name?: string; width?: number; height?: number; fps?: number; background?: string };

export type AssistantMode = "edit" | "preview" | "answer";
export interface AssistantResponse {
  reply: string;
  mode: AssistantMode;
  actions: AssistantAction[];
}
export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
  work?: { elapsedMs: number; commentary: string[]; entries?: AssistantWorkEntry[] };
}
export interface AssistantRequest {
  requestId: string;
  provider: AssistantProvider;
  prompt: string;
  /** The user's composer mode, which limits how the editor can use a reply. */
  mode?: AssistantMode;
  history: AssistantMessage[];
  /** JSON containing only the editor's allowlisted, path-free project summary. */
  context: string;
  /** Small JPEG preview frames explicitly selected for this turn. */
  references?: AssistantReference[];
  codexSelection?: CodexAgentSelection;
}
export interface AssistantProviderInfo {
  id: AssistantCLI;
  label: string;
  available: boolean;
  path?: string;
  version?: string;
  error?: string;
}
export type AssistantEvent = { requestId: string } & (
  | { type: "status"; message: string }
  | { type: "speech-setup-required" }
  | { type: "activity"; kind: AssistantActivityKind; message: string; state?: "done" }
  | { type: "commentary"; text: string }
  | { type: "text"; text: string }
  | { type: "complete"; response: AssistantResponse; transcriptions?: AssistantTranscription[] }
  | { type: "error"; message: string; account?: CodexAgentAccount }
  | { type: "cancelled" }
);
