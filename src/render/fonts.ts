import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import fontEditorCore from "fonteditor-core";
import type { CoverFontKey } from "@/shared/types";

const FONT_SOURCES: Record<CoverFontKey, string> = {
  "nanum-square-round": "@noonnu/nanum-square-round/fonts/nanumsquareround-normal.woff",
  pretendard: "pretendard/dist/public/static/Pretendard-ExtraBold.otf",
  "noto-sans-kr": "@noonnu/noto-sans-kr/fonts/noto-sans-kr-900.otf",
  "gmarket-sans": "@noonnu/gmarket-sans-medium/fonts/gmarketsansmedium-normal.woff",
  "tmoney-round-wind": "@noonnu/tmoney-round-wind-extra-bold/fonts/tmoneyroundwindextrabold-normal.woff",
  "bm-dohyeon": "@kfonts/bm-dohyeon/src/BMDOHYEON_ttf.ttf",
  "bm-hanna": "@kfonts/bm-hanna-pro/src/BMHANNAPro.ttf",
  "bm-jua": "@kfonts/bm-jua/src/BMJUA_ttf.ttf",
  "score-dream-extrabold": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_six@1.2/S-CoreDream-8Heavy.woff",
  "cafe24-dangdanghae": "@noonnu/cafe24-dangdanghae/fonts/cafe24dangdanghae-normal.woff",
  "yg-jalnan": "@noonnu/yg-jalnan/fonts/yg-jalnan-normal.woff",
};

function exactArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function convertWoffToTtf(buffer: Buffer): Buffer {
  const converted = fontEditorCore.woff2ttf(exactArrayBuffer(buffer), {
    inflate(data: number[]) {
      return new Uint8Array(zlib.inflateSync(Buffer.from(data))) as unknown as number[];
    },
  });
  return Buffer.from(converted);
}

async function loadSource(source: string): Promise<Buffer> {
  if (!source.startsWith("https://")) return fs.readFile(path.join(process.cwd(), "node_modules", source));
  const response = await fetch(source);
  if (!response.ok) throw new Error(`폰트 다운로드 실패: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function prepareRenderFont(font: CoverFontKey, outputDir: string): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const source = FONT_SOURCES[font];
  const sourceExt = path.extname(source).toLowerCase();
  const targetExt = sourceExt === ".woff" ? ".ttf" : sourceExt;
  const target = path.join(outputDir, `${font}${targetExt}`);
  try {
    await fs.access(target);
    return target;
  } catch {
    // Generate the cached server-side font below.
  }

  const raw = await loadSource(source);
  const output = sourceExt === ".woff" ? convertWoffToTtf(raw) : raw;
  await fs.writeFile(target, output);
  return target;
}

export async function readRenderFontFamily(fontPath: string): Promise<string> {
  const buffer = await fs.readFile(fontPath);
  const type = path.extname(fontPath).toLowerCase() === ".otf" ? "otf" : "ttf";
  const parsed = fontEditorCore.Font.create(exactArrayBuffer(buffer), { type });
  const family = String(parsed.get().name?.fontFamily ?? "").trim();
  if (!family) throw new Error(`폰트 내부 family name을 읽을 수 없습니다: ${fontPath}`);
  return family;
}
