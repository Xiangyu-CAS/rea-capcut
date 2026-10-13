import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CAPCUT_CODEC_MAX_BYTES,
  decodeCapcutDraft,
} from "../electron/capcutCodec";

// Independent neutral known answer. It contains no native application data,
// proprietary code, device identifiers or real user cryptographic material.
const knownPlaintext =
  '{"tracks":[],"materials":{},"canvas_config":{"width":640,"height":360},"name":"synthetic known answer"}';
const knownCarrier =
  "0123IzU4567wv7PB7ea189abC6CoWBHy7cdefVJ60123MXE4567d+5y6i4k89ab0lycdefdHue9DabcdzpVgix4FTefghgXdTnoijklRGF8I+juVz/ImvyrNR6yRZG0mnop9K7b2dxceBMXzzDO6Xez5ExE37K0QXfSadgw97nrkaKdBMXsIqZzT42SY9G39Zqw6uAgTdt74UfU=";

function neutralCarrier(plaintext: Buffer | string, firstKeyCharacter?: string): string {
  const key = Buffer.from("0123456789abcdef0123456789abcdef", "ascii");
  if (firstKeyCharacter) key[0] = firstKeyCharacter.charCodeAt(0);
  const iv = Buffer.from("abcdefghijklmnop", "ascii");
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64");
    const material = Buffer.concat([key, iv]).toString("ascii");
    const offsets = [0, 7, 20, 33, 40, 47, 59, 66, 76, 89, 99, 127];
    let carrier = "";
    let cursor = 0;
    for (let index = 0; index < offsets.length; index++) {
      const length = offsets[index] - carrier.length;
      carrier +=
        body.slice(cursor, cursor + length) +
        material.slice(index * 4, index * 4 + 4);
      cursor += length;
    }
    return carrier + body.slice(cursor);
  } finally {
    key.fill(0);
    iv.fill(0);
  }
}

describe("independently verified local draft envelope", () => {
  it("decodes a fixed neutral known-answer carrier", () => {
    expect(decodeCapcutDraft(knownCarrier)).toEqual({
      text: knownPlaintext,
      encoding: "embedded-aes-gcm",
    });
    expect(neutralCarrier(knownPlaintext)).toBe(knownCarrier);
  });

  it("does not confuse an embedded ASCII opening brace with plaintext JSON", () => {
    expect(decodeCapcutDraft(neutralCarrier(knownPlaintext, "{"))).toEqual({
      text: knownPlaintext,
      encoding: "embedded-aes-gcm",
    });
  });

  it("accepts plain object JSON with BOM/whitespace while retaining text semantics", () => {
    const source = '{"name":"自建测试","tracks":[],"materials":{}}';
    expect(decodeCapcutDraft(` \n\uFEFF ${source} \t`)).toEqual({
      text: source,
      encoding: "json",
    });
    expect(decodeCapcutDraft("{} ")).toEqual({ text: "{}", encoding: "json" });
  });

  it("rejects JSON primitives, arrays and malformed apparent JSON", () => {
    for (const value of ["null", "true", "123", '"text"', "[]"])
      expect(() => decodeCapcutDraft(value)).toThrow("JSON 对象");
    expect(() => decodeCapcutDraft("{broken")).toThrow("无法解析");
    expect(() => decodeCapcutDraft("[broken")).toThrow("无法解析");
  });

  it("authenticates both ciphertext and embedded material rather than guessing plaintext", () => {
    const changedBody = knownCarrier.slice(0, -10) +
      (knownCarrier.at(-10) === "A" ? "B" : "A") + knownCarrier.slice(-9);
    expect(() => decodeCapcutDraft(changedBody)).toThrow("认证失败");
    expect(() => decodeCapcutDraft("1" + knownCarrier.slice(1))).toThrow(
      "认证失败",
    );
    expect(() => decodeCapcutDraft(knownCarrier.slice(0, -4))).toThrow();
  });

  it("rejects unknown, too-short, non-ASCII and malformed Base64 carriers explicitly", () => {
    for (const source of ["", "opaque-unrecognized", knownCarrier.slice(0, 100)])
      expect(() => decodeCapcutDraft(source)).toThrow("不透明");
    expect(() => decodeCapcutDraft("中" + knownCarrier.slice(1))).toThrow(
      "不透明",
    );
    expect(() =>
      decodeCapcutDraft(knownCarrier.slice(0, 140) + "!" + knownCarrier.slice(141)),
    ).toThrow("不透明");
    expect(() =>
      decodeCapcutDraft(knownCarrier.slice(0, 140) + "\n" + knownCarrier.slice(141)),
    ).toThrow("不透明");
  });

  it("requires canonical padding bits and standard rather than URL-safe Base64", () => {
    // Changing the final U to V changes only unused padding bits. Permissive
    // Buffer decoding produces the same bytes; canonical round-trip rejects it.
    expect(() => decodeCapcutDraft(knownCarrier.slice(0, -2) + "V=")).toThrow(
      "不规范",
    );
    expect(() => decodeCapcutDraft(knownCarrier.replace("+", "-"))).toThrow(
      "不透明",
    );
    expect(() => decodeCapcutDraft(knownCarrier + "=")).toThrow("不透明");
  });

  it("validates UTF-8 and object JSON only after successful authentication", () => {
    const invalidUtf8 = Buffer.alloc(180, 0x20);
    invalidUtf8[0] = 0xff;
    expect(() => decodeCapcutDraft(neutralCarrier(invalidUtf8))).toThrow("UTF-8");
    expect(() =>
      decodeCapcutDraft(neutralCarrier(JSON.stringify("x".repeat(180)))),
    ).toThrow("JSON 对象");
    expect(() =>
      decodeCapcutDraft(neutralCarrier(JSON.stringify(["x".repeat(180)]))),
    ).toThrow("JSON 对象");
    expect(() => decodeCapcutDraft(neutralCarrier("x".repeat(180)))).toThrow(
      "无法解析",
    );
  });

  it("supports authenticated Unicode object JSON and encrypted BOM/whitespace", () => {
    const text = JSON.stringify({
      name: "独立编写的中性样例",
      note: "无人身份信息".repeat(10),
    });
    expect(decodeCapcutDraft(neutralCarrier(`\uFEFF \n${text}\t`))).toEqual({
      text,
      encoding: "embedded-aes-gcm",
    });
  });

  it("limits original UTF-8 input bytes before trimming or parsing", () => {
    expect(() => decodeCapcutDraft(" ".repeat(CAPCUT_CODEC_MAX_BYTES + 1))).toThrow(
      "20 MiB",
    );
    expect(() =>
      decodeCapcutDraft("中".repeat(Math.floor(CAPCUT_CODEC_MAX_BYTES / 3) + 1)),
    ).toThrow("20 MiB");
  });
});
