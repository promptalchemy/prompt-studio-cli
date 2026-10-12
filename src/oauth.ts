import { randomUUID } from "node:crypto";
import {
  Client,
  IssuerMismatchError,
  OAuthError,
  OAuthErrorCode,
  refreshAuthorization,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { openBrowser } from "./browser.js";
import { CliError, classifyError, signInMessage } from "./errors.js";
import { loopbackRedirects, startLoopback } from "./loopback.js";
import { parseUser, payloadFromToolResult } from "./parse.js";
import { CredentialStore, type Session } from "./store.js";
import type { UserProfile } from "./types.js";
import { LOGIN_TIMEOUT_MS, VERSION } from "./version.js";

export interface LoginOptions {
  serverUrl: string;
  env?: NodeJS.ProcessEnv;
  open?: (url: string) => Promise<void>;
  timeoutMs?: number;
  stderr?: (message: string) => void;
}

function redirectUrisOf(client: StoredOAuthClientInformation | undefined): string[] {
  if (!client) return [];
  const value = (client as { redirect_uris?: unknown }).redirect_uris;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function causedByUnauthorized(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current instanceof UnauthorizedError) return true;
    if (!(current instanceof Error)) return false;
    current = current.cause;
  }
  return false;
}

export class PromptStudioAuthProvider implements OAuthClientProvider {
  lastState: string | undefined;
  private verifier: string | undefined;
  private session: Session;

  readonly redirectUrl: string;
  readonly clientMetadata: OAuthClientMetadata;

  constructor(
    private readonly store: CredentialStore,
    serverUrl: string,
    redirectUrl: string,
    private readonly interactive: boolean,
    private readonly open: (url: string) => Promise<void>,
    private readonly stderr?: (message: string) => void,
    private readonly requireRedirectMatch = false,
  ) {
    this.redirectUrl = redirectUrl;
    this.session = store.read(serverUrl);
    this.clientMetadata = {
      client_name: "Prompt Studio CLI",
      redirect_uris: loopbackRedirects(),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
      scope: "read write",
      software_id: "prompt-studio-cli",
      software_version: VERSION,
    };
  }

  state(): string {
    this.lastState = randomUUID();
    return this.lastState;
  }

  clientInformation(ctx?: { issuer: string }): StoredOAuthClientInformation | undefined {
    const client = this.session.client;
    if (!client?.client_id) return undefined;
    if (ctx?.issuer && client.issuer && client.issuer !== ctx.issuer) return undefined;
    if (this.requireRedirectMatch && !redirectUrisOf(client).includes(this.redirectUrl)) return undefined;
    return client;
  }

  saveClientInformation(client: StoredOAuthClientInformation): void {
    this.session.client = client;
    this.store.write(this.session);
  }

  tokens(ctx?: { issuer: string }): StoredOAuthTokens | undefined {
    const tokens = this.session.tokens;
    if (!tokens?.access_token) return undefined;
    if (ctx?.issuer && tokens.issuer && tokens.issuer !== ctx.issuer) return undefined;
    return tokens;
  }

  saveTokens(tokens: StoredOAuthTokens): void {
    this.session.tokens = tokens;
    this.store.write(this.session);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.interactive) throw new CliError(signInMessage(), { status: 401, code: "unauthorized" });
    this.stderr?.("Opening a browser to sign in to Prompt Studio.\n");
    try {
      await this.open(authorizationUrl.toString());
    } catch {
      this.stderr?.("The browser did not open on its own.\n");
    }
    this.stderr?.(`If you are not already signing in, visit:\n${authorizationUrl.toString()}\n`);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.verifier) throw new CliError("Login is missing its PKCE verifier. Run `ps login` again.");
    return this.verifier;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.session.discovery = state;
    this.store.write(this.session);
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.session.discovery;
  }

  saveResourceUrl(resourceUrl: string): void {
    this.session.resourceUrl = resourceUrl;
    this.store.write(this.session);
  }

  resourceUrl(): string | undefined {
    return this.session.resourceUrl;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (scope === "all" || scope === "tokens") delete this.session.tokens;
    if (scope === "all" || scope === "client") delete this.session.client;
    if (scope === "all" || scope === "discovery") delete this.session.discovery;
    if (scope === "all" || scope === "verifier") this.verifier = undefined;
    if (scope !== "verifier") this.store.write(this.session);
  }
}

async function closeQuietly(close: () => Promise<unknown>): Promise<void> {
  await Promise.race([
    Promise.resolve()
      .then(close)
      .then(() => undefined)
      .catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 1500)),
  ]);
}

export async function login(options: LoginOptions): Promise<UserProfile> {
  const env = options.env ?? process.env;
  const store = CredentialStore.fromEnv(env);
  const loopback = await startLoopback();
  const stderr = options.stderr;
  const provider = new PromptStudioAuthProvider(
    store,
    options.serverUrl,
    loopback.redirectUri,
    true,
    options.open ?? ((url) => openBrowser(url)),
    stderr,
    true,
  );
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;
  let client = new Client({ name: "prompt-studio-cli", version: VERSION });
  let transport = new StreamableHTTPClientTransport(new URL(options.serverUrl), { authProvider: provider });
  try {
    try {
      await client.connect(transport);
    } catch (error) {
      if (!causedByUnauthorized(error)) throw error;
      const callback = await loopback.waitForCallback(timeoutMs);
      const state = callback.searchParams.get("state");
      if (!provider.lastState || state !== provider.lastState) {
        throw new CliError("The login response did not match this session. Run `ps login` again.");
      }
      try {
        await transport.finishAuth(callback.searchParams);
      } catch (authError) {
        if (authError instanceof IssuerMismatchError) {
          throw new CliError("Authorization failed because the login response came from an unexpected server. Run `ps login` again.");
        }
        throw authError;
      }
      await closeQuietly(() => client.close());
      client = new Client({ name: "prompt-studio-cli", version: VERSION });
      transport = new StreamableHTTPClientTransport(new URL(options.serverUrl), { authProvider: provider });
      await client.connect(transport);
    }
    const result = await client.callTool({ name: "whoami", arguments: {} }, { timeout: 60_000 });
    return parseUser(payloadFromToolResult(result));
  } catch (error) {
    throw classifyError(error);
  } finally {
    await loopback.close();
    await closeQuietly(() => client.close());
  }
}

/** Exchange the saved refresh token. Used after the resource server returns 401. */
export async function refreshStoredSession(store: CredentialStore, serverUrl: string): Promise<void> {
  const session = store.read(serverUrl);
  const refreshToken = session.tokens?.refresh_token;
  const client = session.client;
  const authorizationServerUrl = session.discovery?.authorizationServerUrl;
  if (!refreshToken || !client || !authorizationServerUrl) {
    throw new CliError(signInMessage(), { status: 401, code: "unauthorized" });
  }
  try {
    const tokens = await refreshAuthorization(authorizationServerUrl, {
      metadata: session.discovery?.authorizationServerMetadata,
      clientInformation: client,
      refreshToken,
      resource: session.resourceUrl,
    });
    session.tokens = { ...tokens, issuer: tokens.issuer ?? session.tokens?.issuer };
    store.write(session);
  } catch (error) {
    if (error instanceof OAuthError && (error.code === OAuthErrorCode.InvalidGrant || error.code === OAuthErrorCode.InvalidClient)) {
      delete session.tokens;
      store.write(session);
    }
    throw new CliError(signInMessage(), { status: 401, code: "unauthorized", cause: error });
  }
}
