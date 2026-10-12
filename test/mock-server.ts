import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface MockPromptStudio {
  url: string;
  issuer: string;
  close(): Promise<void>;
  readonly pkceVerified: boolean;
  readonly registeredRedirects: string[];
  readonly issuedTokens: string[];
  readonly tokenRequests: number;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function send(response: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...extra });
  response.end(payload);
}

export async function startMockPromptStudio(): Promise<MockPromptStudio> {
  const codes = new Map<string, { challenge: string; redirect: string }>();
  const tokens = new Set<string>();
  let pkceVerified = false;
  let registeredRedirects: string[] = [];
  let accessCounter = 0;
  let tokenRequests = 0;

  const server = createServer(async (request, response) => {
    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url ?? "/", `http://${host}`);
    const issuer = `http://${host}`;
    try {
      if (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp") {
        send(response, 200, {
          resource: `${issuer}/mcp`,
          authorization_servers: [issuer],
          scopes_supported: ["read", "write"],
          bearer_methods_supported: ["header"],
          resource_name: "Prompt Studio",
        });
        return;
      }
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        send(response, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          registration_endpoint: `${issuer}/register`,
          scopes_supported: ["read", "write"],
          response_types_supported: ["code"],
          response_modes_supported: ["query"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
          authorization_response_iss_parameter_supported: true,
        });
        return;
      }
      if (url.pathname === "/register" && request.method === "POST") {
        const body = JSON.parse(await readBody(request)) as { redirect_uris?: string[] };
        registeredRedirects = body.redirect_uris ?? [];
        send(response, 201, {
          ...body,
          client_id: "cli-test",
          client_id_issued_at: Math.floor(Date.now() / 1000),
        });
        return;
      }
      if (url.pathname === "/authorize" && request.method === "GET") {
        const code = `code-${codes.size + 1}`;
        const challenge = url.searchParams.get("code_challenge") ?? "";
        const redirect = url.searchParams.get("redirect_uri") ?? "";
        codes.set(code, { challenge, redirect });
        const location = new URL(redirect);
        location.searchParams.set("code", code);
        location.searchParams.set("state", url.searchParams.get("state") ?? "");
        location.searchParams.set("iss", issuer);
        response.writeHead(302, { location: location.toString() });
        response.end();
        return;
      }
      if (url.pathname === "/token" && request.method === "POST") {
        tokenRequests += 1;
        const params = new URLSearchParams(await readBody(request));
        const grant = params.get("grant_type");
        if (grant === "authorization_code") {
          const code = params.get("code") ?? "";
          const saved = codes.get(code);
          const verifier = params.get("code_verifier") ?? "";
          const hashed = createHash("sha256").update(verifier).digest("base64url");
          pkceVerified = Boolean(saved && saved.challenge === hashed && params.get("redirect_uri") === saved.redirect);
          if (!pkceVerified) {
            send(response, 400, { error: "invalid_grant" });
            return;
          }
        } else if (grant !== "refresh_token") {
          send(response, 400, { error: "unsupported_grant_type" });
          return;
        }
        accessCounter += 1;
        const access = `access-${accessCounter}`;
        const refresh = `refresh-${accessCounter}`;
        tokens.add(access);
        send(response, 200, {
          access_token: access,
          refresh_token: refresh,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "read write",
        });
        return;
      }
      if (url.pathname === "/mcp") {
        if (request.method === "GET" || request.method === "DELETE") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        const authorization = request.headers.authorization ?? "";
        const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
        if (!tokens.has(token)) {
          send(response, 401, { error: "invalid_token" }, {
            "www-authenticate": `Bearer realm="OAuth", resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`,
          });
          return;
        }
        const message = JSON.parse(await readBody(request)) as { id?: number | string; method?: string; params?: { protocolVersion?: string; name?: string } };
        if (message.method === "notifications/initialized") {
          response.writeHead(202);
          response.end();
          return;
        }
        if (message.method === "initialize") {
          send(response, 200, {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: message.params?.protocolVersion ?? "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "mock-prompt-studio", version: "0.0.0" },
            },
          }, { "mcp-session-id": "session-1" });
          return;
        }
        if (message.method === "tools/call" && message.params?.name === "whoami") {
          const user = { id: "user-1", email: "ada@example.com", name: "Ada Lovelace", username: "@ada", plan: "pro" };
          send(response, 200, {
            jsonrpc: "2.0",
            id: message.id,
            result: { content: [{ type: "text", text: JSON.stringify(user) }] },
          });
          return;
        }
        send(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: `unknown method ${message.method ?? ""}` },
        });
        return;
      }
      send(response, 404, { error: "not_found", path: url.pathname });
    } catch (error) {
      send(response, 500, { error: error instanceof Error ? error.message : "mock failure" });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock server did not bind");
  const issuer = `http://127.0.0.1:${address.port}`;
  return {
    url: `${issuer}/mcp`,
    issuer,
    get pkceVerified() {
      return pkceVerified;
    },
    get registeredRedirects() {
      return registeredRedirects;
    },
    get issuedTokens() {
      return [...tokens];
    },
    get tokenRequests() {
      return tokenRequests;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
