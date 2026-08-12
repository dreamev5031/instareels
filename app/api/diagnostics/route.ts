import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { checkBinaryVersion } from "@/shared/ffmpeg";
import { WORK_DIR } from "@/jobs/paths";

interface CheckResult {
  ok: boolean;
  detail: string;
}

async function checkWorkDirWritable(): Promise<CheckResult> {
  const marker = path.join(WORK_DIR, ".diagnostics-write-check");
  try {
    await fs.mkdir(WORK_DIR, { recursive: true });
    await fs.writeFile(marker, "ok");
    await fs.unlink(marker);
    return { ok: true, detail: WORK_DIR };
  } catch (err) {
    return { ok: false, detail: `${WORK_DIR}: ${(err as Error).message}` };
  }
}

// A dynamic `import(variable)` can't be resolved by Next's bundler (Turbopack
// rejects it outright), and a static import would only ever fail at build
// time anyway - it wouldn't catch a deployment where the built image is
// missing files (exactly the tesseract.js/bmp-js tracing gap hit earlier).
// Checking the package is actually present on disk is what a post-deploy
// sanity check needs.
async function checkPackagePresent(packageName: string): Promise<CheckResult> {
  const pkgJsonPath = path.join(process.cwd(), "node_modules", packageName, "package.json");
  try {
    await fs.access(pkgJsonPath);
    return { ok: true, detail: pkgJsonPath };
  } catch {
    return { ok: false, detail: `not found: ${pkgJsonPath}` };
  }
}

async function checkBinary(bin: "ffmpeg" | "ffprobe"): Promise<CheckResult> {
  try {
    const version = await checkBinaryVersion(bin);
    return { ok: true, detail: version };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

export async function GET() {
  const [ffmpeg, ffprobe, workDir, tesseract, tesseractCore, msedgeTts] = await Promise.all([
    checkBinary("ffmpeg"),
    checkBinary("ffprobe"),
    checkWorkDirWritable(),
    checkPackagePresent("tesseract.js"),
    checkPackagePresent("tesseract.js-core"),
    checkPackagePresent("msedge-tts"),
  ]);

  const checks = { ffmpeg, ffprobe, work_dir_writable: workDir, tesseract_js: tesseract, tesseract_core: tesseractCore, msedge_tts: msedgeTts };
  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json({ status: allOk ? "ok" : "degraded", checks }, { status: allOk ? 200 : 503 });
}
