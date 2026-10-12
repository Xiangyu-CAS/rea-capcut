import type { Adjustments, Transform, TextStyle } from "./types";
export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  flipX: false,
  flipY: false,
};
export const DEFAULT_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  blur: 0,
};
export const DEFAULT_TEXT: TextStyle = {
  text: "在这里输入文字",
  fontSize: 72,
  fontFamily: "Noto Sans SC",
  color: "#ffffff",
  background: "transparent",
  align: "center",
  bold: true,
  stroke: "#000000",
  strokeWidth: 2,
};
