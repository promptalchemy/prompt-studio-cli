import path from "node:path";
import { Command, CommanderError } from "commander";
import { classifyError, errorPayload } from "./errors.js";
import { dimLine, formatCredits, formatFolders, formatModels, formatPromptPage, formatSourceLine, formatUser, pageHint, printJson, supportsColor } from "./format.js";
import { waitForGeneration } from "./generate.js";
import { connectStudio } from "./mcp.js";
import { login as loginWithBrowser } from "./oauth.js";
import { readPhrase } from "./phrase.js";
import { isUuid, parsePageNumber, pickPrompt, resolveFolder } from "./resolve.js";
import { resolveServerUrl } from "./server-url.js";
import { CredentialStore } from "./store.js";
import type { Studio } from "./types.js";
import { GENERATE_TIMEOUT_MS, POLL_WAIT_MS, VERSION } from "./version.js";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface LoginOptions {
  serverUrl: string;
  env?: NodeJS.ProcessEnv;
  open?: (url: string) => Promise<void>;
  timeoutMs?: number;
  stderr?: (message: string) => void;
}

export interface Runtime {
  io: Io;
  env: NodeJS.ProcessEnv;
  stdinIsTTY: boolean;
  readStdin: () => Promise<string>;
  connect: (serverUrl: string) => Promise<Studio>;
  login: (options: LoginOptions) => Promise<Awaited<ReturnType<Studio["whoami"]>>>;
  logout: (serverUrl: string) => Promise<"signed-out" | "already">;
  /** Replaces the browser opener. Tests use this to finish the loopback redirect. */
  open?: (url: string) => Promise<void>;
}

export async function readStdinStream(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function defaultRuntime(): Runtime {
  const io: Io = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  };
  return {
    io,
    env: process.env,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    readStdin: readStdinStream,
    connect: (serverUrl) => connectStudio(serverUrl, process.env),
    login: (options) => loginWithBrowser({ ...options, env: process.env, stderr: (text) => io.stderr(text) }),
    logout: (serverUrl) => Promise.resolve(CredentialStore.fromEnv(process.env).clearTokens(serverUrl)),
  };
}

function writeError(io: Io, json: boolean, error: ReturnType<typeof classifyError>): void {
  io.stderr(json ? printJson(errorPayload(error)) : `${error.message}\n`);
}

async function usingStudio<T>(runtime: Runtime, serverUrl: string, fn: (studio: Studio) => Promise<T>): Promise<T> {
  const studio = await runtime.connect(serverUrl);
  try {
    return await fn(studio);
  } finally {
    await studio.close();
  }
}

async function folderId(studio: Studio, folder: string | undefined): Promise<string | undefined> {
  if (!folder) return undefined;
  return resolveFolder(await studio.listFolders(), folder).id;
}

export async function run(argv: string[], overrides: Partial<Runtime> = {}): Promise<number> {
  const runtime: Runtime = { ...defaultRuntime(), ...overrides };
  if (!overrides.connect) runtime.connect = (serverUrl) => connectStudio(serverUrl, runtime.env);
  if (!overrides.login) {
    runtime.login = (options) => loginWithBrowser({
      ...options,
      env: runtime.env,
      open: options.open ?? runtime.open,
      stderr: (text) => runtime.io.stderr(text),
    });
  }
  if (!overrides.logout) {
    runtime.logout = (serverUrl) => Promise.resolve(CredentialStore.fromEnv(runtime.env).clearTokens(serverUrl));
  }
  const jsonMode = argv.includes("--json");
  const invoked = path.basename(argv[1] ?? "ps").replace(/\.(js|cjs|mjs)$/, "");
  const program = new Command();
  program
    .name(invoked === "promptstudio" ? "promptstudio" : "ps")
    .description("Use your Prompt Studio library from the terminal")
    .version(VERSION)
    .option("--json", "print JSON to stdout")
    .option("--server <url>", "MCP server URL (default: the hosted Prompt Studio server)")
    .configureOutput({
      writeOut: (text) => runtime.io.stdout(text),
      writeErr: (text) => runtime.io.stderr(text),
    })
    .exitOverride()
    .showHelpAfterError()
    .addHelpText("after", `
Examples:
  $ ps login
  $ ps list
  $ ps search lighting
  $ ps get "my prompt"
  $ echo "a calm still life" | ps save --title "Still life" --folder Fun
  $ ps credits
  $ ps generate <prompt-id> --model flux-2-pro
`);

  const withCommon = (command: Command): Command => command
    .option("--json", "print JSON to stdout")
    .option("--server <url>", "MCP server URL (default: the hosted Prompt Studio server)");

  const serverOf = (command: Command): string => resolveServerUrl(
    (command.opts().server ?? command.parent?.opts().server) as string | undefined,
    runtime.env,
  );
  const wantsJson = (command: Command): boolean => Boolean(command.opts().json || command.parent?.opts().json);

  withCommon(program.command("login").description("Sign in with Prompt Studio in your browser")).action(async function (this: Command) {
    const user = await runtime.login({ serverUrl: serverOf(this) });
    runtime.io.stderr("Signed in.\n");
    runtime.io.stdout(wantsJson(this) ? printJson(user) : formatUser(user));
  });

  withCommon(program.command("logout").description("Forget the saved session on this machine")).action(async function (this: Command) {
    const result = await runtime.logout(serverOf(this));
    runtime.io.stdout(result === "already" ? "Already signed out.\n" : "Signed out.\n");
  });

  withCommon(program.command("whoami").description("Show the signed-in account")).action(async function (this: Command) {
    const user = await usingStudio(runtime, serverOf(this), (studio) => studio.whoami());
    runtime.io.stdout(wantsJson(this) ? printJson(user) : formatUser(user));
  });

  withCommon(program.command("credits").description("Show the image-credit balance")).action(async function (this: Command) {
    const credits = await usingStudio(runtime, serverOf(this), (studio) => studio.credits());
    runtime.io.stdout(wantsJson(this) ? printJson(credits) : formatCredits(credits));
  });

  withCommon(program.command("folders").description("List folders")).action(async function (this: Command) {
    const folders = await usingStudio(runtime, serverOf(this), (studio) => studio.listFolders());
    runtime.io.stdout(wantsJson(this) ? printJson(folders) : formatFolders(folders));
  });

  withCommon(program.command("models").description("List image models you can pass to generate --model")).action(async function (this: Command) {
    const catalog = await usingStudio(runtime, serverOf(this), (studio) => studio.listModels());
    runtime.io.stdout(wantsJson(this) ? printJson(catalog) : formatModels(catalog));
  });

  withCommon(program.command("list").description("List prompts, newest first"))
    .option("-f, --folder <name-or-id>", "limit to a folder")
    .option("--page <n>", "page number", "1")
    .option("--page-size <n>", "page size, max 50", "50")
    .action(async function (this: Command) {
      const opts = this.opts();
      const page = parsePageNumber(String(opts.page), "Page");
      const pageSize = parsePageNumber(String(opts.pageSize), "Page size", 50);
      const result = await usingStudio(runtime, serverOf(this), async (studio) => {
        const id = await folderId(studio, opts.folder as string | undefined);
        return studio.listPrompts({ folderId: id, page, pageSize });
      });
      runtime.io.stdout(wantsJson(this) ? printJson(result) : formatPromptPage(result));
      const hint = pageHint(result, "ps list");
      if (hint && !wantsJson(this)) runtime.io.stderr(`${hint}\n`);
    });

  withCommon(program.command("search").description("Search prompts by title and text"))
    .argument("<query>", "words to find in the title or prompt")
    .option("-f, --folder <name-or-id>", "limit to a folder")
    .option("--page <n>", "page number", "1")
    .option("--page-size <n>", "page size, max 50", "20")
    .action(async function (this: Command, query: string) {
      const opts = this.opts();
      const page = parsePageNumber(String(opts.page), "Page");
      const pageSize = parsePageNumber(String(opts.pageSize), "Page size", 50);
      const result = await usingStudio(runtime, serverOf(this), async (studio) => {
        const id = await folderId(studio, opts.folder as string | undefined);
        return studio.searchPrompts(query, { folderId: id, page, pageSize });
      });
      runtime.io.stdout(wantsJson(this) ? printJson(result) : formatPromptPage(result));
      const hint = pageHint(result, `ps search ${JSON.stringify(query)}`);
      if (hint && !wantsJson(this)) runtime.io.stderr(`${hint}\n`);
    });

  withCommon(program.command("get").description("Print a prompt's text. Use an id or a title."))
    .argument("<id-or-title>", "prompt id, or a title to look up")
    .action(async function (this: Command, selector: string) {
      const detail = await usingStudio(runtime, serverOf(this), async (studio) => {
        if (isUuid(selector)) return studio.getPrompt(selector);
        const found = await studio.searchPrompts(selector, { page: 1, pageSize: 20 });
        return studio.getPrompt(pickPrompt(selector, found.prompts).id);
      });
      if (wantsJson(this)) {
        runtime.io.stdout(printJson(detail));
        return;
      }
      runtime.io.stdout(detail.phrase.endsWith("\n") ? detail.phrase : `${detail.phrase}\n`);
      const source = formatSourceLine(detail.sourceUrl);
      if (source) {
        const colored = supportsColor(runtime.env, Boolean(process.stderr.isTTY));
        runtime.io.stderr(`${dimLine(source, colored)}\n`);
      }
    });

  withCommon(program.command("save").description("Save a prompt from arguments or stdin"))
    .argument("[phrase...]", "prompt text; omit to read stdin")
    .option("-t, --title <title>", "prompt title")
    .option("-f, --folder <name-or-id>", "folder name or id")
    .action(async function (this: Command, phraseArgs: string[]) {
      const opts = this.opts();
      const phrase = await readPhrase(phraseArgs, runtime.readStdin, runtime.stdinIsTTY);
      const saved = await usingStudio(runtime, serverOf(this), async (studio) => studio.createPrompt({
        phrase,
        name: opts.title as string | undefined,
        folderId: await folderId(studio, opts.folder as string | undefined),
      }));
      runtime.io.stdout(wantsJson(this) ? printJson(saved) : `Saved "${saved.name}" (${saved.id})\n`);
    });

  withCommon(program.command("generate").description("Generate an image for a prompt and print the output URL"))
    .argument("<id-or-title>", "prompt id, or a title to look up")
    .option("-m, --model <id>", "image model id (default flux-2-pro)")
    .option("--timeout <seconds>", "how long to wait for the image", String(GENERATE_TIMEOUT_MS / 1000))
    .action(async function (this: Command, selector: string) {
      const opts = this.opts();
      const timeoutSec = parsePageNumber(String(opts.timeout), "Timeout");
      const result = await usingStudio(runtime, serverOf(this), async (studio) => {
        const promptId = isUuid(selector)
          ? selector
          : pickPrompt(selector, (await studio.searchPrompts(selector, { page: 1, pageSize: 20 })).prompts).id;
        let previous = "";
        return waitForGeneration(
          () => studio.generateImage({ promptId, modelId: opts.model as string | undefined }),
          (jobId, waitMs) => studio.pollGeneration(jobId, waitMs),
          {
            timeoutMs: timeoutSec * 1000,
            waitMs: POLL_WAIT_MS,
            onStatus: (status) => {
              if (status === previous || wantsJson(this)) return;
              previous = status;
              runtime.io.stderr(`${status}\n`);
            },
          },
        );
      });
      runtime.io.stdout(wantsJson(this) ? printJson(result) : `${result.url}\n`);
    });

  try {
    const rest = argv.slice(2);
    if (rest.length === 0) {
      program.outputHelp();
      return 0;
    }
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode;
    const cliError = classifyError(error);
    writeError(runtime.io, jsonMode, cliError);
    return cliError.exitCode;
  }
}
