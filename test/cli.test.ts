import { describe, expect, it } from "vitest";
import { CliError } from "../src/errors.js";
import { run, type Io, type Runtime } from "../src/cli.js";
import type { Studio } from "../src/types.js";

function capture(): { io: Io; out: () => string; err: () => string } {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
    out: () => stdout,
    err: () => stderr,
  };
}

function studio(partial: Partial<Studio> = {}): Studio {
  return {
    async whoami() {
      return { id: "u1", email: "a@b.c", name: "Ada", username: "@ada", plan: "pro" };
    },
    async credits() {
      return { total: 42, currencyCode: "CRD", upgradeUrl: "https://promptstudio.app" };
    },
    async listFolders() {
      return [{ id: "f1", name: "Fun", icon: null, parentId: null }];
    },
    async listPrompts() {
      return {
        page: 1,
        pageSize: 50,
        total: 1,
        prompts: [{ id: "p1", name: "Cup", phrasePreview: "ceramic", folder: { id: "f1", name: "Fun" }, updatedAt: null, accessRole: "owner" }],
      };
    },
    async searchPrompts() {
      return {
        page: 1,
        pageSize: 20,
        total: 1,
        prompts: [{ id: "p1", name: "Cup", phrasePreview: null, folder: null, updatedAt: null, accessRole: "owner" }],
      };
    },
    async getPrompt() {
      return { id: "p1", name: "Cup", phrase: "a calm ceramic cup", folder: null, accessRole: "owner", assets: [] };
    },
    async createPrompt(input) {
      return { id: "p2", name: input.name ?? "untitled prompt", folderId: input.folderId ?? null };
    },
    async listModels() {
      return { defaultModelId: "flux-2-pro", models: [{ id: "flux-2-pro", name: "Flux 2 Pro", credits: 1, supportsRefs: true, inPicker: true }] };
    },
    async generateImage() {
      return { job_id: "job-1", status: "succeeded", output_url: "https://cdn.example/out.png" };
    },
    async pollGeneration() {
      return { job_id: "job-1", status: "succeeded", output_url: "https://cdn.example/out.png" };
    },
    async close() {},
    ...partial,
  };
}

function runtime(io: Io, connected: Studio, extra: Partial<Runtime> = {}): Partial<Runtime> {
  return {
    io,
    env: {},
    stdinIsTTY: true,
    connect: async () => connected,
    ...extra,
  };
}

describe("cli", () => {
  it("prints help and version", async () => {
    const help = capture();
    expect(await run(["node", "ps"], { io: help.io, env: {} })).toBe(0);
    expect(help.out()).toContain("login");
    expect(help.out()).toContain("generate");
    const version = capture();
    expect(await run(["node", "promptstudio", "--version"], { io: version.io, env: {} })).toBe(0);
    expect(version.out().trim()).toBe("0.1.0");
  });

  it("prints whoami, credits, and a pipeable prompt", async () => {
    const who = capture();
    expect(await run(["node", "ps", "whoami"], runtime(who.io, studio()))).toBe(0);
    expect(who.out()).toContain("Ada");
    expect(who.out()).toContain("pro");

    const credits = capture();
    expect(await run(["node", "ps", "credits", "--json"], runtime(credits.io, studio()))).toBe(0);
    expect(JSON.parse(credits.out())).toMatchObject({ total: 42, currencyCode: "CRD" });

    const got = capture();
    expect(await run(["node", "ps", "get", "Cup"], runtime(got.io, studio()))).toBe(0);
    expect(got.out()).toBe("a calm ceramic cup\n");
    expect(got.err()).toBe("");
  });

  it("prints an imported source on stderr and in json", async () => {
    const connected = studio({
      async getPrompt() {
        return {
          id: "p1",
          name: "Cup",
          phrase: "a calm ceramic cup",
          folder: null,
          accessRole: "owner",
          assets: [],
          sourceUrl: "https://x.com/promptstudio/status/1",
          sourceType: "x",
        };
      },
    });
    const got = capture();
    expect(await run(["node", "ps", "get", "Cup"], runtime(got.io, connected))).toBe(0);
    expect(got.out()).toBe("a calm ceramic cup\n");
    expect(got.err()).toBe("Source: x.com/promptstudio/status/1\n");

    const json = capture();
    expect(await run(["node", "ps", "get", "Cup", "--json"], runtime(json.io, connected))).toBe(0);
    expect(JSON.parse(json.out())).toMatchObject({
      phrase: "a calm ceramic cup",
      sourceUrl: "https://x.com/promptstudio/status/1",
      sourceType: "x",
    });
    expect(json.err()).toBe("");
  });

  it("saves stdin into a folder and generates an image url", async () => {
    const saved = capture();
    const code = await run(["node", "ps", "save", "--title", "Cup", "--folder", "Fun"], {
      ...runtime(saved.io, studio()),
      stdinIsTTY: false,
      readStdin: async () => "a calm ceramic cup\n",
    });
    expect(code).toBe(0);
    expect(saved.out()).toContain("p2");

    const generated = capture();
    expect(await run(["node", "ps", "generate", "p1", "--model", "flux-2-pro"], runtime(generated.io, studio()))).toBe(0);
    expect(generated.out()).toBe("https://cdn.example/out.png\n");
  });

  it("reports sign-in and credit errors", async () => {
    const signedOut = capture();
    const denied = await run(["node", "ps", "list"], runtime(signedOut.io, studio(), {
      connect: async () => {
        throw new CliError("Sign-in is required. Run `ps login`.", { status: 401, code: "unauthorized" });
      },
    }));
    expect(denied).toBe(1);
    expect(signedOut.err()).toContain("ps login");

    const broke = capture();
    const payment = await run(["node", "ps", "--json", "generate", "p1"], runtime(broke.io, studio({
      async generateImage() {
        throw new CliError("Image credits are used up. Add credits at https://promptstudio.app", { status: 402, code: "OUT_OF_CREDITS" });
      },
    })));
    expect(payment).toBe(1);
    expect(JSON.parse(broke.err())).toMatchObject({ status: 402, code: "OUT_OF_CREDITS" });
  });
});
