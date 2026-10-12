import { spawn, type SpawnOptions } from "node:child_process";

export interface BrowserLaunch {
  command: string;
  args: string[];
}

export function browserLaunch(platform: NodeJS.Platform, url: string): BrowserLaunch {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

export async function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  spawnImpl: typeof spawn = spawn,
): Promise<void> {
  const launch = browserLaunch(platform, url);
  await new Promise<void>((resolve, reject) => {
    const options: SpawnOptions = { stdio: "ignore", detached: platform !== "win32" };
    const child = spawnImpl(launch.command, launch.args, options);
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
