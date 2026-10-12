import type { CallToolResult } from "@modelcontextprotocol/client";
import { CliError, classifyError, infoFromPayload } from "./errors.js";
import { asNumber, asRecord, asString, isHttpUrl, parseJsonText } from "./json.js";
import type {
  Credits,
  Folder,
  ModelCatalog,
  ModelInfo,
  PromptAsset,
  PromptDetail,
  PromptPage,
  PromptSummary,
  SavedPrompt,
  UserProfile,
} from "./types.js";

const URL_KEYS = ["output_url", "signed_url", "image_url", "download_url", "url"] as const;
const SKIP_URL_KEYS = new Set(["thumbnail_url", "upgrade_url", "token", "access_token", "refresh_token"]);

export function textFromToolResult(result: CallToolResult): string {
  const chunks: string[] = [];
  for (const block of result.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") chunks.push(block.text);
  }
  return chunks.join("\n").trim();
}

export function payloadFromToolResult(result: CallToolResult): unknown {
  const text = textFromToolResult(result);
  const parsed = parseJsonText(text);
  const payload = result.structuredContent !== undefined ? result.structuredContent : (parsed ?? (text ? text : undefined));
  if (result.isError) {
    const info = infoFromPayload(payload ?? text);
    throw classifyError({
      status: info.status,
      code: info.code,
      message: info.message ?? (text || "Prompt Studio tool failed."),
    });
  }
  const info = infoFromPayload(payload);
  if (info.status !== undefined && info.status >= 400) throw classifyError(info);
  if (info.code && /UPGRADE_REQUIRED|OUT_OF_CREDITS|PLAN_LIMIT|PAYMENT_REQUIRED|invalid_token/.test(info.code)) {
    throw classifyError(info);
  }
  if (payload === undefined) throw new CliError("Prompt Studio returned an empty tool result.");
  return payload;
}

function folderOf(value: unknown): { id: string; name: string } | null {
  const record = asRecord(value);
  const id = asString(record?.id);
  const name = asString(record?.name);
  if (!id || !name) return null;
  return { id, name };
}

function summaryOf(value: unknown): PromptSummary {
  const record = asRecord(value);
  const id = asString(record?.id);
  if (!id) throw new CliError("Prompt Studio returned a prompt without an id.");
  return {
    id,
    name: asString(record?.name) ?? "untitled prompt",
    phrasePreview: asString(record?.phrase_preview) ?? asString(record?.phrasePreview) ?? null,
    folder: folderOf(record?.folder),
    updatedAt: asString(record?.updated_at) ?? asString(record?.updatedAt) ?? null,
    accessRole: asString(record?.access_role) ?? asString(record?.accessRole) ?? null,
  };
}

export function parsePromptPage(payload: unknown): PromptPage {
  const record = asRecord(payload);
  const rows = Array.isArray(payload) ? payload : record?.prompts;
  if (!Array.isArray(rows)) throw new CliError("Prompt Studio returned an unexpected prompt list.");
  return {
    page: asNumber(record?.page) ?? 1,
    pageSize: asNumber(record?.page_size) ?? asNumber(record?.pageSize) ?? rows.length,
    total: asNumber(record?.total) ?? null,
    prompts: rows.map(summaryOf),
  };
}

function assetOf(value: unknown): PromptAsset | undefined {
  const record = asRecord(value);
  const id = asString(record?.id);
  if (!id) return undefined;
  const url = asString(record?.url);
  return {
    id,
    kind: asString(record?.kind) ?? null,
    origin: asString(record?.origin) ?? null,
    name: asString(record?.name) ?? null,
    url: url && isHttpUrl(url) ? url : null,
  };
}

export function parsePromptDetail(payload: unknown): PromptDetail {
  const record = asRecord(payload) ?? asRecord(asRecord(payload)?.prompt);
  const id = asString(record?.id);
  if (!id) throw new CliError("Prompt Studio returned a prompt without an id.");
  const assets = Array.isArray(record?.assets) ? record.assets.flatMap((item) => {
    const asset = assetOf(item);
    return asset ? [asset] : [];
  }) : [];
  return {
    id,
    name: asString(record?.name) ?? "untitled prompt",
    phrase: asString(record?.phrase) ?? "",
    folder: folderOf(record?.folder),
    accessRole: asString(record?.access_role) ?? asString(record?.accessRole) ?? null,
    assets,
  };
}

export function parseFolders(payload: unknown): Folder[] {
  const record = asRecord(payload);
  const rows = Array.isArray(payload) ? payload : record?.folders;
  if (!Array.isArray(rows)) throw new CliError("Prompt Studio returned an unexpected folder list.");
  return rows.flatMap((item) => {
    const row = asRecord(item);
    const id = asString(row?.id);
    const name = asString(row?.name);
    if (!id || !name) return [];
    return [{
      id,
      name,
      icon: asString(row?.icon) ?? null,
      parentId: asString(row?.parent_id) ?? asString(row?.parentId) ?? null,
    }];
  });
}

export function parseUser(payload: unknown): UserProfile {
  const record = asRecord(payload) ?? asRecord(asRecord(payload)?.user);
  const id = asString(record?.id);
  if (!id) throw new CliError("Prompt Studio did not return a user id.");
  return {
    id,
    email: asString(record?.email) ?? null,
    name: asString(record?.name) ?? null,
    username: asString(record?.username) ?? null,
    plan: asString(record?.plan) ?? null,
  };
}

export function parseCredits(payload: unknown): Credits {
  const record = asRecord(payload);
  const credits = asRecord(record?.credits) ?? record;
  return {
    total: asNumber(credits?.total) ?? asNumber(record?.total) ?? null,
    currencyCode: asString(credits?.currencyCode) ?? asString(credits?.currency_code) ?? asString(record?.currencyCode) ?? null,
    upgradeUrl: asString(record?.upgrade_url) ?? asString(record?.upgradeUrl) ?? null,
  };
}

export function parseSavedPrompt(payload: unknown): SavedPrompt {
  const record = asRecord(payload);
  const nested = asRecord(record?.prompt);
  const source = asString(nested?.id) ? nested : record;
  const id = asString(source?.id);
  if (!id) throw new CliError("Prompt Studio saved the prompt without returning an id.");
  const folder = folderOf(source?.folder);
  return {
    id,
    name: asString(source?.name) ?? "untitled prompt",
    folderId: asString(source?.folder_id) ?? asString(source?.folderId) ?? folder?.id ?? null,
  };
}

function modelOf(value: unknown, inPicker: boolean): ModelInfo | undefined {
  const record = asRecord(value);
  const id = asString(record?.id);
  if (!id) return undefined;
  return {
    id,
    name: asString(record?.name) ?? id,
    credits: asNumber(record?.credits_cost) ?? asNumber(record?.credits) ?? null,
    supportsRefs: record?.supports_refs === true || record?.supportsRefs === true,
    inPicker: record?.in_picker === true || record?.inPicker === true || inPicker,
  };
}

export function parseModels(payload: unknown): ModelCatalog {
  const record = asRecord(payload);
  const picker = Array.isArray(record?.models) ? record.models : [];
  const extra = Array.isArray(record?.extra_models) ? record.extra_models : [];
  const models = [
    ...picker.flatMap((item) => {
      const model = modelOf(item, true);
      return model ? [model] : [];
    }),
    ...extra.flatMap((item) => {
      const model = modelOf(item, false);
      return model ? [model] : [];
    }),
  ];
  return {
    defaultModelId: asString(record?.default_model_id) ?? asString(record?.defaultModelId) ?? null,
    models,
  };
}

function findKeyedUrl(value: unknown, keys: readonly string[], depth = 0): string | undefined {
  if (depth > 8 || value == null) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKeyedUrl(item, keys, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of keys) {
    const candidate = asString(record[key]);
    if (candidate && isHttpUrl(candidate)) return candidate;
  }
  for (const [key, child] of Object.entries(record)) {
    if (SKIP_URL_KEYS.has(key)) continue;
    const found = findKeyedUrl(child, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function findOutputAssetUrl(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value == null) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findOutputAssetUrl(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const origin = asString(record.origin);
  const url = asString(record.url);
  if (origin === "output" && url && isHttpUrl(url)) return url;
  for (const [key, child] of Object.entries(record)) {
    if (SKIP_URL_KEYS.has(key)) continue;
    const found = findOutputAssetUrl(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** Prefer an explicit output URL over a thumbnail or an input reference. */
export function extractOutputUrl(value: unknown): string | undefined {
  return findKeyedUrl(value, URL_KEYS.slice(0, 4)) ?? findOutputAssetUrl(value) ?? findKeyedUrl(value, ["url"]);
}

export function extractStatus(value: unknown, depth = 0): string | undefined {
  if (depth > 6) return undefined;
  const record = asRecord(value);
  if (!record) return undefined;
  const status = asString(record.status);
  if (status) return status.toLowerCase();
  for (const key of ["job", "generation", "result"]) {
    const nested = extractStatus(record[key], depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

export function extractJobId(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ["job_id", "generation_job_id", "jobId"]) {
    const id = asString(record[key]);
    if (id) return id;
  }
  const job = asRecord(record.job) ?? asRecord(record.generation);
  const nested = asString(job?.id);
  if (nested) return nested;
  const id = asString(record.id);
  if (id && (asString(record.status) || asString(record.prompt_id) || asString(record.promptId))) return id;
  return undefined;
}

export function extractJobError(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return asString(record.error_message) ?? asString(record.error) ?? asString(record.message) ?? extractJobError(record.job);
}

const TERMINAL = new Set(["succeeded", "success", "failed", "error", "canceled", "cancelled"]);

export function isTerminalStatus(status: string | undefined): boolean {
  return status !== undefined && TERMINAL.has(status);
}

export function isSuccessStatus(status: string | undefined): boolean {
  return status === "succeeded" || status === "success";
}

export function isFailureStatus(status: string | undefined): boolean {
  return status === "failed" || status === "error" || status === "canceled" || status === "cancelled";
}
