import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CredentialStore } from "../src/store.js";

describe("CredentialStore", () => {
  it("saves tokens with a private file mode and logout keeps the client", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ps-cli-"));
    const store = new CredentialStore(path.join(dir, "credentials.json"));
    const serverUrl = "https://mcp.promptstudio.app/mcp";
    store.write({
      version: 1,
      serverUrl,
      client: { client_id: "abc", redirect_uris: ["http://127.0.0.1:53682/callback"] },
      tokens: { access_token: "access", refresh_token: "refresh", token_type: "Bearer" },
    });
    if (process.platform !== "win32") {
      expect(statSync(path.join(dir, "credentials.json")).mode & 0o777).toBe(0o600);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
    expect(store.read(serverUrl).tokens?.access_token).toBe("access");
    expect(store.read("https://other.example/mcp").tokens).toBeUndefined();
    expect(store.clearTokens(serverUrl)).toBe("signed-out");
    expect(store.read(serverUrl).tokens).toBeUndefined();
    expect(store.read(serverUrl).client?.client_id).toBe("abc");
    expect(store.clearTokens(serverUrl)).toBe("already");
  });
});
