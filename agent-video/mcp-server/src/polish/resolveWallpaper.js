// Resolve wallpaper spec for OpenScreen polish (color, file path, or macOS desktop).

import { existsSync, copyFileSync, mkdirSync, statSync } from "fs";
import { join, extname } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";

const FALLBACK_COLOR = "#0f172a";
const SESSION_WALLPAPER = "wallpaper.jpg";

const BROWSER_SAFE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function colorSpec(value, fallbackReason) {
  return {
    type: "color",
    value: value || FALLBACK_COLOR,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

function imageSpec(sourcePath, sessionDir) {
  return {
    type: "image",
    url: `/${SESSION_WALLPAPER}`,
    source: sourcePath,
    path: join(sessionDir, SESSION_WALLPAPER),
  };
}

export function resolveWallpaperInput(raw) {
  const env = process.env.DEMOCLAW_WALLPAPER?.trim();
  if (env) return env;
  return raw ?? FALLBACK_COLOR;
}

function resolveMacOSDesktopPath() {
  if (process.platform !== "darwin") return null;

  const swift = spawnSync(
    "swift",
    [
      "-e",
      'import Cocoa; let u = NSWorkspace.shared.desktopImageURL(for: NSScreen.main!); print(u?.path ?? "")',
    ],
    { encoding: "utf-8" }
  );
  if (swift.status === 0) {
    const path = swift.stdout.trim();
    if (path && existsSync(path)) return path;
  }

  const osa = spawnSync(
    "osascript",
    ["-e", 'tell application "Finder" to get POSIX path of (desktop picture as alias)'],
    { encoding: "utf-8" }
  );
  if (osa.status === 0) {
    const path = osa.stdout.trim();
    if (path && existsSync(path)) return path;
  }

  const plistPath = join(
    homedir(),
    "Library/Application Support/com.apple.wallpaper/Store/Index.plist"
  );
  if (!existsSync(plistPath)) return null;

  try {
    const plist = spawnSync(
      "plutil",
      ["-convert", "json", "-o", "-", plistPath],
      { encoding: "utf-8" }
    );
    if (plist.status !== 0) return null;
    const data = JSON.parse(plist.stdout);
    const entries = data?.AllSpacesAndDisplays?.Spaces || data?.Spaces;
    if (!entries) return null;

    const first = Object.values(entries)[0];
    const imagePath =
      first?.Desktop?.Content?.["file://"] ||
      first?.Desktop?.Content ||
      first?.Content?.["file://"] ||
      first?.Content;
    if (typeof imagePath === "string") {
      const decoded = decodeURIComponent(imagePath.replace(/^file:\/\//, ""));
      if (existsSync(decoded)) return decoded;
    }
  } catch {
    return null;
  }

  return null;
}

function ensureSessionDir(sessionDir) {
  if (existsSync(sessionDir)) {
    if (!statSync(sessionDir).isDirectory()) {
      throw new Error(`sessionDir is not a directory: ${sessionDir}`);
    }
    return;
  }
  mkdirSync(sessionDir, { recursive: true });
}

function materializeWallpaper(sourcePath, sessionDir, { log = console.error } = {}) {
  ensureSessionDir(sessionDir);
  const outPath = join(sessionDir, SESSION_WALLPAPER);
  const ext = extname(sourcePath).toLowerCase();

  if (BROWSER_SAFE_EXT.has(ext)) {
    copyFileSync(sourcePath, outPath);
    log(`[wallpaper] copied ${sourcePath} -> ${outPath}`);
    return outPath;
  }

  if (process.platform !== "darwin") {
    return null;
  }

  const sips = spawnSync("sips", ["-s", "format", "jpeg", sourcePath, "--out", outPath], {
    encoding: "utf-8",
  });
  if (sips.status !== 0 || !existsSync(outPath)) {
    log(`[wallpaper] sips convert failed: ${sips.stderr?.trim() || sips.stdout?.trim()}`);
    return null;
  }

  log(`[wallpaper] converted ${sourcePath} -> ${outPath}`);
  return outPath;
}

function resolveImageWallpaper(sourcePath, sessionDir, { log } = {}) {
  if (!sourcePath || !existsSync(sourcePath)) {
    return colorSpec(FALLBACK_COLOR, `wallpaper not found: ${sourcePath}`);
  }

  const materialized = materializeWallpaper(sourcePath, sessionDir, { log });
  if (!materialized) {
    return colorSpec(FALLBACK_COLOR, `failed to materialize wallpaper from ${sourcePath}`);
  }

  return imageSpec(sourcePath, sessionDir);
}

export function resolveWallpaper(raw, sessionDir, { log = console.error } = {}) {
  const input = resolveWallpaperInput(raw);

  if (typeof input === "string" && input.startsWith("#")) {
    return colorSpec(input);
  }

  if (input === "macos") {
    const desktopPath = resolveMacOSDesktopPath();
    if (!desktopPath) {
      log("[wallpaper] macOS desktop wallpaper not resolved; using fallback color");
      return colorSpec(FALLBACK_COLOR, "macOS wallpaper unavailable");
    }
    log(`[wallpaper] resolved macOS desktop: ${desktopPath}`);
    return resolveImageWallpaper(desktopPath, sessionDir, { log });
  }

  if (typeof input === "string" && input.length > 0) {
    return resolveImageWallpaper(input, sessionDir, { log });
  }

  return colorSpec(FALLBACK_COLOR, "invalid wallpaper input");
}
