import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { CliError } from "./errors.js";
import { LOOPBACK_PORTS } from "./version.js";

export function loopbackRedirect(port: number): string {
  return `http://127.0.0.1:${port}/callback`;
}

export function loopbackRedirects(ports: readonly number[] = LOOPBACK_PORTS): string[] {
  return ports.map(loopbackRedirect);
}

export interface Loopback {
  port: number;
  redirectUri: string;
  waitForCallback(timeoutMs: number): Promise<URL>;
  close(): Promise<void>;
}

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Prompt Studio CLI</title>
<p>Signed in. You can close this window and return to the terminal.</p>
`;

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export async function startLoopback(ports: readonly number[] = LOOPBACK_PORTS): Promise<Loopback> {
  let lastError: unknown;
  for (const port of ports) {
    try {
      return await listen(port);
    } catch (error) {
      lastError = error;
    }
  }
  throw new CliError(`Could not listen on 127.0.0.1 ports ${ports.join(", ")}.`, { cause: lastError });
}

function listen(port: number): Promise<Loopback> {
  let settle: ((url: URL) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const pending = new Promise<URL>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  const server: Server = createServer((request, response) => {
    handle(request, response, port, settle, fail);
  });

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.close();
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve({
        port,
        redirectUri: loopbackRedirect(port),
        waitForCallback(timeoutMs: number) {
          const timer = setTimeout(() => {
            fail?.(new CliError("Login timed out before the browser finished. Run `ps login` again."));
          }, timeoutMs);
          return pending.finally(() => clearTimeout(timer));
        },
        close() {
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

function handle(
  request: IncomingMessage,
  response: ServerResponse,
  port: number,
  settle: ((url: URL) => void) | undefined,
  fail: ((error: Error) => void) | undefined,
): void {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (request.method !== "GET" || url.pathname !== "/callback") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  if (url.searchParams.get("error")) {
    response.end("<!doctype html><title>Prompt Studio CLI</title><p>Authorization was declined. Return to the terminal.</p>");
    fail?.(new CliError("Authorization was declined. Run `ps login` again."));
    return;
  }
  response.end(PAGE);
  settle?.(url);
}
