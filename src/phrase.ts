import { CliError } from "./errors.js";

export async function readPhrase(
  args: readonly string[],
  readStdin: () => Promise<string>,
  stdinIsTTY: boolean,
): Promise<string> {
  const fromArgs = args.join(" ").trim();
  if (fromArgs) return fromArgs;
  if (stdinIsTTY) {
    throw new CliError("Pass the prompt text as arguments, or pipe it on stdin.", { exitCode: 2 });
  }
  const raw = await readStdin();
  const text = raw.replace(/\r?\n$/, "");
  if (!text.trim()) throw new CliError("Stdin did not include prompt text.", { exitCode: 2 });
  return text;
}
