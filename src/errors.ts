import { SdkHttpError, UnauthorizedError } from "@modelcontextprotocol/client";

export class CliError extends Error {
  readonly exitCode: number;
  readonly status: number | undefined;
  readonly code: string | undefined;

  constructor(
    message: string,
    options?: { exitCode?: number; status?: number; code?: string; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "CliError";
    this.exitCode = options?.exitCode ?? 1;
    this.status = options?.status;
    this.code = options?.code;
  }
}

const PLAN_CODES = new Set(["UPGRADE_REQUIRED", "OUT_OF_CREDITS", "PLAN_LIMIT", "PAYMENT_REQUIRED"]);

export interface ErrorInfo {
  status?: number;
  code?: string;
  message?: string;
}

export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/(access_token|refresh_token|code_verifier|client_secret)(["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1$2[redacted]");
}

export function paymentMessage(code: string | undefined, fallback?: string): string {
  switch (code) {
    case "OUT_OF_CREDITS":
      return "Image credits are used up. Add credits at https://promptstudio.app";
    case "UPGRADE_REQUIRED":
      return "Image generation needs Prompt Studio Pro. Upgrade at https://promptstudio.app";
    case "PLAN_LIMIT":
      return "This action is over the free plan limit. Upgrade at https://promptstudio.app";
    default:
      return fallback?.trim() || "Prompt Studio refused this request because of the plan or credit balance. See https://promptstudio.app";
  }
}

export function signInMessage(): string {
  return "Sign-in is required. Run `ps login`.";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function codeFromUnknown(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 80) return undefined;
  return normalized;
}

export function infoFromPayload(payload: unknown): ErrorInfo {
  const record = asRecord(payload);
  if (!record) {
    if (typeof payload === "string" && payload.trim()) return { message: payload.trim() };
    return {};
  }
  const nested = asRecord(record.error);
  const code =
    codeFromUnknown(record.code) ??
    codeFromUnknown(record.error_code) ??
    codeFromUnknown(typeof record.error === "string" ? record.error : undefined) ??
    codeFromUnknown(nested?.code) ??
    codeFromUnknown(nested?.error);
  const statusValue = record.status ?? record.statusCode ?? nested?.status;
  const status = typeof statusValue === "number" ? statusValue : undefined;
  const messageValue = record.message ?? record.error_description ?? nested?.message ?? nested?.error_description;
  const message = typeof messageValue === "string" ? messageValue : undefined;
  return { status, code, message };
}

function walk(error: unknown, depth = 0): ErrorInfo {
  if (depth > 6 || error == null) return {};
  if (error instanceof CliError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof UnauthorizedError) {
    return { status: 401, code: "unauthorized", message: error.message };
  }
  if (error instanceof SdkHttpError) {
    const body = infoFromPayload(error.data);
    return {
      status: error.status,
      code: body.code,
      message: body.message ?? error.message,
    };
  }
  if (typeof error === "string") return infoFromPayload(tryJson(error) ?? error);
  if (error instanceof Error) {
    const parsed = infoFromPayload(tryJson(error.message) ?? error.message);
    const cause = walk((error as Error & { cause?: unknown }).cause, depth + 1);
    return {
      status: parsed.status ?? cause.status,
      code: parsed.code ?? cause.code,
      message: parsed.message ?? cause.message ?? error.message,
    };
  }
  return infoFromPayload(error);
}

function tryJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function codeMentioned(info: ErrorInfo): string | undefined {
  if (info.code && PLAN_CODES.has(info.code)) return info.code;
  const haystack = `${info.code ?? ""} ${info.message ?? ""}`;
  for (const code of PLAN_CODES) {
    if (haystack.includes(code)) return code;
  }
  if (/\b401\b|invalid_token|unauthorized/i.test(haystack)) return info.code ?? "unauthorized";
  return info.code;
}

export function classifyError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  const info = walk(error);
  const code = codeMentioned(info);
  const message = redactSecrets(info.message ?? (error instanceof Error ? error.message : "Prompt Studio request failed."));
  if (info.status === 401 || code === "invalid_token" || code === "unauthorized" || error instanceof UnauthorizedError) {
    return new CliError(signInMessage(), { status: 401, code: code ?? "unauthorized", cause: error });
  }
  if (info.status === 402 || (code !== undefined && PLAN_CODES.has(code))) {
    return new CliError(paymentMessage(code, message), { status: 402, code, cause: error });
  }
  if (info.status === 403 || code === "FORBIDDEN") {
    return new CliError(message || "This prompt is view-only for the signed-in account.", {
      status: 403,
      code: code ?? "forbidden",
      cause: error,
    });
  }
  return new CliError(message || "Prompt Studio request failed.", {
    status: info.status,
    code,
    cause: error,
  });
}

export function errorPayload(error: CliError): { error: string; code?: string; status?: number } {
  return {
    error: error.message,
    ...(error.code ? { code: error.code } : {}),
    ...(error.status ? { status: error.status } : {}),
  };
}
