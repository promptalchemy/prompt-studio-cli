import { CliError } from "./errors.js";
import {
  extractJobError,
  extractJobId,
  extractOutputUrl,
  extractStatus,
  isFailureStatus,
  isSuccessStatus,
  isTerminalStatus,
} from "./parse.js";

export interface GenerationWaitOptions {
  timeoutMs: number;
  waitMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onStatus?: (status: string) => void;
}

export async function waitForGeneration(
  start: () => Promise<unknown>,
  poll: (jobId: string, waitMs: number) => Promise<unknown>,
  options: GenerationWaitOptions,
): Promise<{ url: string; jobId: string | null; status: string }> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + options.timeoutMs;
  let payload = await start();
  let status = extractStatus(payload) ?? "queued";
  options.onStatus?.(status);
  const immediate = finishIfReady(payload, status, extractJobId(payload) ?? null);
  if (immediate) return immediate;

  const jobId = extractJobId(payload);
  if (!jobId) throw new CliError("Image generation did not return a job id.");

  while (now() < deadline) {
    const remaining = deadline - now();
    const waitMs = Math.min(options.waitMs, Math.max(0, remaining));
    const started = now();
    payload = await poll(jobId, waitMs);
    status = extractStatus(payload) ?? status;
    options.onStatus?.(status);
    const done = finishIfReady(payload, status, jobId);
    if (done) return done;
    const elapsed = now() - started;
    if (elapsed < 250) await sleep(Math.min(1000, Math.max(0, deadline - now())));
  }
  throw new CliError(`Image generation is still ${status} after ${Math.round(options.timeoutMs / 1000)}s. Job ${jobId}.`);
}

function finishIfReady(payload: unknown, status: string, jobId: string | null): { url: string; jobId: string | null; status: string } | undefined {
  if (isFailureStatus(status)) {
    const detail = extractJobError(payload);
    throw new CliError(detail ? `Image generation ${status}: ${detail}` : `Image generation ${status}.`, { code: status });
  }
  const url = extractOutputUrl(payload);
  if (isSuccessStatus(status) || (isTerminalStatus(status) && url)) {
    if (!url) throw new CliError(`Image generation succeeded without an output URL.${jobId ? ` Job ${jobId}.` : ""}`);
    return { url, jobId, status };
  }
  if (url && isTerminalStatus(status)) return { url, jobId, status };
  return undefined;
}
