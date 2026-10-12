import { CliError } from "./errors.js";
import type { Folder, PromptSummary } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function resolveFolder(folders: readonly Folder[], input: string): Folder {
  if (isUuid(input)) {
    const found = folders.find((folder) => folder.id === input);
    if (!found) throw new CliError(`No folder has id ${input}. Run \`ps folders\` to list them.`, { exitCode: 2 });
    return found;
  }
  const matches = folders.filter((folder) => folder.name.toLowerCase() === input.toLowerCase());
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw new CliError(`No folder is named "${input}". Run \`ps folders\` to list them.`, { exitCode: 2 });
  }
  const lines = matches.map((folder) => `${folder.id}  ${folder.name}`);
  throw new CliError(`Several folders are named "${input}". Pass a folder id:\n${lines.join("\n")}`, { exitCode: 2 });
}

export function pickPrompt(query: string, prompts: readonly PromptSummary[]): PromptSummary {
  if (prompts.length === 0) throw new CliError(`No prompt matched "${query}".`, { exitCode: 2 });
  const exact = prompts.filter((prompt) => prompt.name.toLowerCase() === query.toLowerCase());
  if (exact.length === 1) return exact[0]!;
  const pool = exact.length > 1 ? exact : prompts.length === 1 ? prompts : [];
  if (pool.length === 1) return pool[0]!;
  const shown = (exact.length > 1 ? exact : prompts).slice(0, 15);
  const lines = shown.map((prompt) => `${prompt.id}  ${prompt.name}`);
  throw new CliError(`Several prompts match "${query}". Pass an id:\n${lines.join("\n")}`, { exitCode: 2 });
}

export function parsePageNumber(value: string, label: string, max?: number): number {
  if (!/^\d+$/.test(value)) throw new CliError(`${label} must be a whole number.`, { exitCode: 2 });
  const parsed = Number(value);
  if (parsed < 1) throw new CliError(`${label} starts at 1.`, { exitCode: 2 });
  if (max !== undefined && parsed > max) throw new CliError(`${label} must be ${max} or less.`, { exitCode: 2 });
  return parsed;
}
