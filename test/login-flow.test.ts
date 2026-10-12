import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { startMockPromptStudio, type MockPromptStudio } from "./mock-server.js";

describe("login", () => {
  let mock: MockPromptStudio | undefined;

  afterEach(async () => {
    await mock?.close();
  });

  it("completes browser PKCE login against a loopback callback and reuses the session", async () => {
    mock = await startMockPromptStudio();
    const dir = mkdtempSync(path.join(tmpdir(), "ps-login-"));
    const env = { PROMPTSTUDIO_CONFIG_DIR: dir };
    let opened = 0;
    let out = "";
    let err = "";
    const io = {
      stdout: (text: string) => {
        out += text;
      },
      stderr: (text: string) => {
        err += text;
      },
    };
    const code = await run(["node", "ps", "login", "--server", mock.url], {
      env,
      io,
      open: async (url) => {
        opened += 1;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`authorize redirect failed: ${response.status}`);
      },
    });
    expect(code).toBe(0);
    expect(opened).toBe(1);
    expect(mock.pkceVerified).toBe(true);
    expect(mock.registeredRedirects.some((uri) => uri.startsWith("http://127.0.0.1:"))).toBe(true);
    expect(out).toContain("Ada Lovelace");
    expect(err).toContain("Signed in.");
    const tokenCallsAfterLogin = mock.tokenRequests;
    if (process.platform !== "win32") {
      expect(statSync(path.join(dir, "credentials.json")).mode & 0o777).toBe(0o600);
    }

    out = "";
    const again = await run(["node", "ps", "whoami", "--server", mock.url], {
      env,
      io,
      open: async () => {
        throw new Error("whoami should reuse the saved session");
      },
    });
    expect(again).toBe(0);
    expect(out).toContain("ada@example.com");
    expect(mock.tokenRequests).toBe(tokenCallsAfterLogin);
  });
});
