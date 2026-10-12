import { CliError } from "./errors.js";
import { DEFAULT_SERVER_URL } from "./version.js";

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

export function normalizeServerUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CliError(`Server URL is invalid: ${input}`, { exitCode: 2 });
  }
  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new CliError("The server URL must use https.", { exitCode: 2 });
  }
  url.hash = "";
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

export function resolveServerUrl(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  return normalizeServerUrl(flag || env.PROMPTSTUDIO_MCP_URL || DEFAULT_SERVER_URL);
}
