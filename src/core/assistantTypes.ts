export type AssistantProvider = "codex" | "claude";

export type AssistantAction =
  | { type: "addText"; text: string; start: number; duration: number; fontSize?: number; color?: string; x?: number; y?: number }
  | { type: "addAsset"; assetId: string; start: number; trackId?: string; duration?: number }
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

export interface AssistantResponse { reply: string; actions: AssistantAction[] }
export interface AssistantMessage { role: "user" | "assistant"; content: string }
export interface AssistantRequest {
  requestId: string;
  provider: AssistantProvider;
  prompt: string;
  history: AssistantMessage[];
  /** JSON containing only the editor's allowlisted, path-free project summary. */
  context: string;
}
export interface AssistantProviderInfo {
  id: AssistantProvider;
  label: string;
  available: boolean;
  path?: string;
  version?: string;
  error?: string;
}
export type AssistantEvent = { requestId: string } & (
  | { type: "status"; message: string }
  | { type: "text"; text: string }
  | { type: "complete"; response: AssistantResponse }
  | { type: "error"; message: string }
  | { type: "cancelled" }
);
