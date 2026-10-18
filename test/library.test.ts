import { describe, expect, it } from "vitest";
import { extractOutputUrl } from "../src/parse.js";
import { parseCredits, parseFolders, parseModels, parsePromptDetail, parsePromptPage, parseUser } from "../src/parse.js";
import { pickPrompt, resolveFolder } from "../src/resolve.js";
import { readPhrase } from "../src/phrase.js";
import { waitForGeneration } from "../src/generate.js";
import { dimLine, formatPromptPage, formatSourceLine, formatUser, supportsColor } from "../src/format.js";
import { browserLaunch } from "../src/browser.js";
import { loopbackRedirects } from "../src/loopback.js";
import { configDir } from "../src/paths.js";
import { normalizeServerUrl } from "../src/server-url.js";

const prompt = {
  id: "e4b64406-b82e-44b6-8674-3eaf76559904",
  name: "Ward Apple Watch",
  phrase_preview: "A calm glance",
  folder: { id: "folder-1", name: "Ward" },
  updated_at: "2026-10-11T10:40:55.602373+00:00",
  access_role: "owner",
};

describe("parsers", () => {
  it("reads the hosted tool shapes", () => {
    expect(parseUser({ id: "u1", email: "a@b.c", name: "Ada", username: "@ada", plan: "pro" })).toMatchObject({
      plan: "pro",
      username: "@ada",
    });
    expect(parseCredits({ credits: { total: 42, currencyCode: "CRD" }, upgrade_url: "https://promptstudio.app" })).toEqual({
      total: 42,
      currencyCode: "CRD",
      upgradeUrl: "https://promptstudio.app",
    });
    expect(parseFolders({ folders: [{ id: "f1", name: "Fun", icon: "game", parent_id: null }] })).toEqual([
      { id: "f1", name: "Fun", icon: "game", parentId: null },
    ]);
    const page = parsePromptPage({ page: 1, page_size: 2, total: 10, prompts: [prompt] });
    expect(page.prompts[0]?.folder?.name).toBe("Ward");
    const detail = parsePromptDetail({ ...prompt, phrase: "full text", assets: [] });
    expect(detail.phrase).toBe("full text");
    expect(detail.sourceUrl).toBeUndefined();
    expect(detail.sourceType).toBeUndefined();
    expect(formatSourceLine(detail.sourceUrl)).toBeUndefined();
    const models = parseModels({
      default_model_id: "flux-2-pro",
      models: [{ id: "flux-2-pro", name: "Flux 2 Pro", credits_cost: 1, supports_refs: true, in_picker: true }],
      extra_models: [{ id: "recraft-v4", name: "Recraft V4", credits_cost: 1, supports_refs: false, in_picker: false }],
    });
    expect(models.defaultModelId).toBe("flux-2-pro");
    expect(models.models.map((model) => model.id)).toEqual(["flux-2-pro", "recraft-v4"]);
  });
});

describe("prompt source", () => {
  it("reads source_url and source_type and prints a compact line", () => {
    const detail = parsePromptDetail({
      ...prompt,
      phrase: "full text",
      assets: [],
      source_url: "https://x.com/promptstudio/status/1",
      source_type: "x",
    });
    expect(detail.sourceUrl).toBe("https://x.com/promptstudio/status/1");
    expect(detail.sourceType).toBe("x");
    expect(formatSourceLine(detail.sourceUrl)).toBe("Source: x.com/promptstudio/status/1");
    expect(JSON.parse(JSON.stringify(detail))).toMatchObject({
      sourceUrl: "https://x.com/promptstudio/status/1",
      sourceType: "x",
    });
  });

  it("accepts camelCase fields and a web page", () => {
    const detail = parsePromptDetail({
      id: prompt.id,
      phrase: "full text",
      sourceUrl: "https://example.com/posts/1?ref=a",
      sourceType: "web",
    });
    expect(detail.sourceType).toBe("web");
    expect(formatSourceLine(detail.sourceUrl)).toBe("Source: example.com/posts/1?ref=a");
  });

  it("ignores a blank url, a non-http url, and an unknown source type", () => {
    const detail = parsePromptDetail({
      ...prompt,
      phrase: "full text",
      assets: [],
      source_url: "  ",
      source_type: "tweet",
    });
    expect(detail.sourceUrl).toBeUndefined();
    expect(detail.sourceType).toBeUndefined();
    expect("sourceUrl" in detail).toBe(false);
    const unsafe = parsePromptDetail({ id: prompt.id, phrase: "full text", source_url: "javascript:alert(1)", source_type: "web" });
    expect(unsafe.sourceUrl).toBeUndefined();
    expect(unsafe.sourceType).toBe("web");
  });

  it("shows a source url when an older server omits source_type", () => {
    const detail = parsePromptDetail({
      id: prompt.id,
      phrase: "full text",
      source_url: "https://chatgpt.com/share/abc",
    });
    expect(detail.sourceType).toBeUndefined();
    expect(formatSourceLine(detail.sourceUrl)).toBe("Source: chatgpt.com/share/abc");
  });

  it("dims the source line only when the terminal uses color", () => {
    expect(dimLine("Source: x.com/a", true)).toBe("\u001b[2mSource: x.com/a\u001b[22m");
    expect(dimLine("Source: x.com/a", false)).toBe("Source: x.com/a");
    expect(supportsColor({ NO_COLOR: "1" }, true)).toBe(false);
    expect(supportsColor({ TERM: "dumb" }, true)).toBe(false);
    expect(supportsColor({}, false)).toBe(false);
    expect(supportsColor({}, true)).toBe(true);
  });
});

describe("extractOutputUrl", () => {
  it("prefers the output url over a thumbnail", () => {
    expect(extractOutputUrl({
      status: "succeeded",
      thumbnail_url: "https://cdn.example/thumb.jpg",
      output_url: "https://cdn.example/out.jpg",
    })).toBe("https://cdn.example/out.jpg");
  });

  it("uses an origin=output asset url", () => {
    expect(extractOutputUrl({
      status: "succeeded",
      assets: [
        { origin: "input", url: "https://cdn.example/ref.jpg" },
        { origin: "output", url: "https://cdn.example/final.jpg" },
      ],
    })).toBe("https://cdn.example/final.jpg");
  });
});

describe("resolve", () => {
  const folders = [
    { id: "11111111-1111-4111-8111-111111111111", name: "Fun", icon: null, parentId: null },
    { id: "22222222-2222-4222-8222-222222222222", name: "Fun", icon: null, parentId: "parent" },
    { id: "33333333-3333-4333-8333-333333333333", name: "Ward", icon: null, parentId: null },
  ];

  it("matches a folder by unique name or id", () => {
    expect(resolveFolder(folders, "ward").id).toBe(folders[2]?.id);
    expect(resolveFolder(folders, folders[0]!.id).name).toBe("Fun");
    expect(() => resolveFolder(folders, "Fun")).toThrow(/Several folders/);
    expect(() => resolveFolder(folders, "Missing")).toThrow(/No folder/);
  });

  it("picks an exact title before a single fuzzy hit", () => {
    const rows = [
      { id: "1", name: "Lighting", phrasePreview: null, folder: null, updatedAt: null, accessRole: null },
      { id: "2", name: "Soft lighting setup", phrasePreview: null, folder: null, updatedAt: null, accessRole: null },
    ];
    expect(pickPrompt("lighting", rows).id).toBe("1");
    expect(() => pickPrompt("light", rows)).toThrow(/Several prompts/);
    expect(pickPrompt("only", [rows[1]!]).id).toBe("2");
  });
});

describe("readPhrase", () => {
  it("uses arguments and otherwise stdin", async () => {
    await expect(readPhrase(["a", "calm", "cup"], async () => "ignored", true)).resolves.toBe("a calm cup");
    await expect(readPhrase([], async () => "from stdin\n", false)).resolves.toBe("from stdin");
    await expect(readPhrase([], async () => "", true)).rejects.toThrow(/stdin/);
    await expect(readPhrase([], async () => "\n", false)).rejects.toThrow(/Stdin/);
  });
});

describe("waitForGeneration", () => {
  it("polls until the output url is ready", async () => {
    let calls = 0;
    let time = 0;
    const result = await waitForGeneration(
      async () => ({ job_id: "job-1", status: "queued" }),
      async () => {
        calls += 1;
        time += 1000;
        return calls < 2 ? { job_id: "job-1", status: "running" } : { job_id: "job-1", status: "succeeded", output_url: "https://cdn.example/out.png" };
      },
      { timeoutMs: 10_000, waitMs: 1000, now: () => time, sleep: async () => undefined },
    );
    expect(result.url).toBe("https://cdn.example/out.png");
    expect(result.jobId).toBe("job-1");
  });

  it("stops on failure and on timeout", async () => {
    await expect(waitForGeneration(
      async () => ({ job_id: "job-2", status: "failed", error: "provider down" }),
      async () => ({}),
      { timeoutMs: 1000, waitMs: 100, now: () => 0 },
    )).rejects.toThrow(/provider down/);

    let time = 0;
    await expect(waitForGeneration(
      async () => ({ job_id: "job-3", status: "running" }),
      async () => ({ job_id: "job-3", status: "running" }),
      {
        timeoutMs: 1500,
        waitMs: 1000,
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
      },
    )).rejects.toThrow(/still running/);
  });
});

describe("formatting and paths", () => {
  it("prints prompt text lines and account fields", () => {
    const page = parsePromptPage({ page: 1, page_size: 1, total: 1, prompts: [prompt] });
    expect(formatPromptPage(page)).toContain("Ward Apple Watch");
    expect(formatUser({ id: "u", email: "a@b.c", name: "Ada", username: "@ada", plan: "pro" })).toContain("Plan: pro");
  });

  it("chooses an OS config directory and loopback redirects", () => {
    expect(configDir({ PROMPTSTUDIO_CONFIG_DIR: "/tmp/ps" })).toBe("/tmp/ps");
    expect(configDir({}, "darwin", "/Users/ada")).toBe("/Users/ada/Library/Application Support/prompt-studio-cli");
    expect(configDir({ XDG_CONFIG_HOME: "/xdg" }, "linux", "/home/ada")).toBe("/xdg/prompt-studio-cli");
    expect(configDir({ APPDATA: "C:\\App" }, "win32", "C:\\Users\\ada")).toBe("C:\\App\\prompt-studio-cli");
    expect(loopbackRedirects([53682])[0]).toBe("http://127.0.0.1:53682/callback");
    expect(browserLaunch("darwin", "http://127.0.0.1/cb").command).toBe("open");
    expect(browserLaunch("linux", "http://127.0.0.1/cb").command).toBe("xdg-open");
    expect(normalizeServerUrl("https://mcp.promptstudio.app/mcp/")).toBe("https://mcp.promptstudio.app/mcp");
    expect(() => normalizeServerUrl("http://example.com/mcp")).toThrow(/https/);
  });
});
