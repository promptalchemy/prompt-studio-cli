import os from "node:os";
import path from "node:path";

function pathFor(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

export interface PathEnv {
  PROMPTSTUDIO_CONFIG_DIR?: string;
  XDG_CONFIG_HOME?: string;
  APPDATA?: string;
}

/** OS config directory. Override with PROMPTSTUDIO_CONFIG_DIR. */
export function configDir(
  env: PathEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  const join = pathFor(platform);
  if (env.PROMPTSTUDIO_CONFIG_DIR) return env.PROMPTSTUDIO_CONFIG_DIR;
  if (platform === "win32") {
    const base = env.APPDATA || join.join(home, "AppData", "Roaming");
    return join.join(base, "prompt-studio-cli");
  }
  if (platform === "darwin") {
    return join.join(home, "Library", "Application Support", "prompt-studio-cli");
  }
  const base = env.XDG_CONFIG_HOME || join.join(home, ".config");
  return join.join(base, "prompt-studio-cli");
}

export function credentialsPath(dir: string = configDir()): string {
  return path.join(dir, "credentials.json");
}
