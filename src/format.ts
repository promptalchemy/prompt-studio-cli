import type { Credits, Folder, ModelCatalog, PromptPage, PromptSummary, UserProfile } from "./types.js";

export function printJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function formatUser(user: UserProfile): string {
  const lines = [
    user.name ? `Name: ${user.name}` : undefined,
    user.email ? `Email: ${user.email}` : undefined,
    user.username ? `Username: ${user.username}` : undefined,
    user.plan ? `Plan: ${user.plan}` : undefined,
    `Id: ${user.id}`,
  ].filter((line): line is string => Boolean(line));
  return `${lines.join("\n")}\n`;
}

export function formatCredits(credits: Credits): string {
  if (credits.total == null) return "Credit balance is unavailable.\n";
  const unit = credits.currencyCode ?? "credits";
  return `${credits.total} ${unit}\n`;
}

export function formatPromptLine(prompt: PromptSummary): string {
  const folder = prompt.folder?.name ?? "-";
  return `${prompt.id}  ${folder}  ${prompt.name}`;
}

export function formatPromptPage(page: PromptPage): string {
  if (page.prompts.length === 0) return "No prompts.\n";
  return `${page.prompts.map(formatPromptLine).join("\n")}\n`;
}

export function formatFolders(folders: readonly Folder[]): string {
  if (folders.length === 0) return "No folders.\n";
  return `${folders.map((folder) => `${folder.id}  ${folder.name}`).join("\n")}\n`;
}

export function formatModels(catalog: ModelCatalog): string {
  if (catalog.models.length === 0) return "No image models.\n";
  const lines = catalog.models.map((model) => {
    const credits = model.credits == null ? "" : `  ${model.credits} credit${model.credits === 1 ? "" : "s"}`;
    const picker = model.inPicker ? "" : "  (extra)";
    return `${model.id}  ${model.name}${credits}${picker}`;
  });
  if (catalog.defaultModelId) lines.push("", `Default: ${catalog.defaultModelId}`);
  return `${lines.join("\n")}\n`;
}

export function pageHint(page: PromptPage, command: string): string | undefined {
  if (page.total == null) return undefined;
  const shownUntil = (page.page - 1) * page.pageSize + page.prompts.length;
  if (page.total <= shownUntil) return undefined;
  return `Showing ${page.prompts.length} of ${page.total}. Next: ${command} --page ${page.page + 1}`;
}
