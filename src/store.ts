import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OAuthDiscoveryState, StoredOAuthClientInformation, StoredOAuthTokens } from "@modelcontextprotocol/client";
import { CliError } from "./errors.js";
import { configDir, credentialsPath } from "./paths.js";

export interface Session {
  version: 1;
  serverUrl: string;
  client?: StoredOAuthClientInformation;
  tokens?: StoredOAuthTokens;
  discovery?: OAuthDiscoveryState;
  resourceUrl?: string;
}

function empty(serverUrl: string): Session {
  return { version: 1, serverUrl };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class CredentialStore {
  constructor(private readonly filePath: string = credentialsPath()) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): CredentialStore {
    return new CredentialStore(credentialsPath(configDir(env)));
  }

  read(serverUrl: string): Session {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return empty(serverUrl);
      throw new CliError("Could not read the Prompt Studio credentials file.", { cause: error });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new CliError("The credentials file is not valid JSON. Run `ps logout`, then `ps login`.", { cause: error });
    }
    if (!isRecord(parsed) || parsed.version !== 1 || typeof parsed.serverUrl !== "string") {
      throw new CliError("The credentials file is unreadable. Run `ps logout`, then `ps login`.");
    }
    if (parsed.serverUrl !== serverUrl) return empty(serverUrl);
    const session = empty(serverUrl);
    if (isRecord(parsed.client) && typeof parsed.client.client_id === "string") {
      session.client = parsed.client as StoredOAuthClientInformation;
    }
    if (isRecord(parsed.tokens) && typeof parsed.tokens.access_token === "string") {
      session.tokens = parsed.tokens as StoredOAuthTokens;
    }
    if (isRecord(parsed.discovery) && typeof parsed.discovery.authorizationServerUrl === "string") {
      session.discovery = parsed.discovery as unknown as OAuthDiscoveryState;
    }
    if (typeof parsed.resourceUrl === "string") session.resourceUrl = parsed.resourceUrl;
    return session;
  }

  write(session: Session): void {
    const dir = path.dirname(this.filePath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Windows does not honor POSIX modes.
    }
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // Windows does not honor POSIX modes.
    }
    renameSync(tmp, this.filePath);
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      // Windows does not honor POSIX modes.
    }
  }

  clearTokens(serverUrl: string): "signed-out" | "already" {
    const session = this.read(serverUrl);
    if (!session.tokens) return "already";
    delete session.tokens;
    delete session.discovery;
    this.write(session);
    return "signed-out";
  }
}
