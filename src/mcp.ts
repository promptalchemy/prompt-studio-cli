import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { classifyError, signInMessage, CliError } from "./errors.js";
import { refreshStoredSession } from "./oauth.js";
import {
  parseCredits,
  parseFolders,
  parseModels,
  parsePromptDetail,
  parsePromptPage,
  parseSavedPrompt,
  parseUser,
  payloadFromToolResult,
} from "./parse.js";
import { CredentialStore } from "./store.js";
import type { ListQuery, Studio } from "./types.js";
import { VERSION } from "./version.js";

async function closeQuietly(close: () => Promise<unknown>): Promise<void> {
  await Promise.race([
    Promise.resolve()
      .then(close)
      .then(() => undefined)
      .catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 1500)),
  ]);
}

class McpStudio implements Studio {
  constructor(private readonly client: Client) {}

  whoami() {
    return this.call("whoami", {}).then(parseUser);
  }

  credits() {
    return this.call("get_credits", {}).then(parseCredits);
  }

  listFolders() {
    return this.call("list_folders", {}).then(parseFolders);
  }

  listPrompts(query: ListQuery) {
    return this.call("list_prompts", {
      ...(query.folderId ? { folder_id: query.folderId } : {}),
      ...(query.page ? { page: query.page } : {}),
      ...(query.pageSize ? { page_size: query.pageSize } : {}),
    }).then(parsePromptPage);
  }

  searchPrompts(query: string, options: ListQuery) {
    return this.call("search_prompts", {
      query,
      ...(options.folderId ? { folder_id: options.folderId } : {}),
      ...(options.page ? { page: options.page } : {}),
      ...(options.pageSize ? { page_size: options.pageSize } : {}),
    }).then(parsePromptPage);
  }

  getPrompt(id: string) {
    return this.call("get_prompt", { id }).then(parsePromptDetail);
  }

  createPrompt(input: { phrase: string; name?: string; folderId?: string }) {
    return this.call("create_prompt", {
      phrase: input.phrase,
      ...(input.name ? { name: input.name } : {}),
      ...(input.folderId ? { folder_id: input.folderId } : {}),
    }).then(parseSavedPrompt);
  }

  listModels() {
    return this.call("list_generate_models", {}).then(parseModels);
  }

  generateImage(input: { promptId: string; modelId?: string }) {
    return this.call("generate_image", {
      prompt_id: input.promptId,
      ...(input.modelId ? { model_id: input.modelId } : {}),
    }, 60_000);
  }

  pollGeneration(jobId: string, waitMs: number) {
    return this.call("poll_generation", { job_id: jobId, wait_ms: waitMs }, 90_000);
  }

  close() {
    return closeQuietly(() => this.client.close());
  }

  private async call(name: string, args: Record<string, unknown>, timeout = 60_000): Promise<unknown> {
    try {
      const result = await this.client.callTool({ name, arguments: args }, { timeout });
      return payloadFromToolResult(result);
    } catch (error) {
      throw classifyError(error);
    }
  }
}

export async function connectStudio(serverUrl: string, env: NodeJS.ProcessEnv = process.env): Promise<Studio> {
  const store = CredentialStore.fromEnv(env);
  const session = store.read(serverUrl);
  if (!session.tokens?.access_token) throw new CliError(signInMessage(), { status: 401, code: "unauthorized" });
  const client = new Client({ name: "prompt-studio-cli", version: VERSION });
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    authProvider: {
      async token() {
        return store.read(serverUrl).tokens?.access_token;
      },
      async onUnauthorized() {
        await refreshStoredSession(store, serverUrl);
      },
    },
  });
  try {
    await client.connect(transport);
  } catch (error) {
    await closeQuietly(() => client.close());
    throw classifyError(error);
  }
  return new McpStudio(client);
}
