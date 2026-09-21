/** Resolving a provider name from config.toml into something callable.
 *
 *  Two backends sit behind one interface: the AI SDK for anything with an API
 *  key, and a subprocess for the `cli` kind, which bills against a Claude or
 *  Codex subscription instead of API credits (SPEC 9.3). */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { LanguageModel } from "ai";
import { cli, secrets, type Config, type Provider } from "../ipc";

export class ProviderError extends Error {}

export interface Resolved {
  name: string;
  provider: Provider;
  /** Present for API backends only. */
  model?: LanguageModel;
  /** Present for the cli backend only. */
  runCli?: (prompt: string) => Promise<string>;
  /** Used to warn when the judge shares a vendor with the pass (SPEC 11). */
  vendor: string;
}

const DEFAULT_MODEL: Record<string, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-5.2",
  google: "gemini-3-pro",
};

/** Requests go through Rust's HTTP client, so CORS never applies. */
const http = tauriFetch as unknown as typeof globalThis.fetch;

export function providerNames(config: Config): string[] {
  return Object.keys(config.providers);
}

export async function resolve(config: Config, name: string): Promise<Resolved> {
  const provider = config.providers[name];
  if (!provider) {
    throw new ProviderError(
      `no provider named "${name}" in config.toml — have: ${providerNames(config).join(", ") || "none"}`,
    );
  }

  if (provider.kind === "cli") {
    if (!provider.command) {
      throw new ProviderError(`provider "${name}" is kind = "cli" but has no command`);
    }
    return {
      name,
      provider,
      vendor: `cli:${provider.command}`,
      runCli: (prompt: string) => cli.run(provider, prompt),
    };
  }

  const apiKey = await secrets.resolve(provider.keyRef);
  if (!apiKey) {
    throw new ProviderError(
      `provider "${name}" has no key. Set key_ref in config.toml to env:NAME or keychain:service/account.`,
    );
  }

  const id = provider.model ?? DEFAULT_MODEL[provider.kind] ?? "";
  if (!id) {
    throw new ProviderError(`provider "${name}" needs a model in config.toml`);
  }

  let model: LanguageModel;
  switch (provider.kind) {
    case "anthropic":
      model = createAnthropic({ apiKey, fetch: http })(id);
      break;
    case "openai":
      model = createOpenAI({ apiKey, fetch: http })(id);
      break;
    case "google":
      model = createGoogleGenerativeAI({ apiKey, fetch: http })(id);
      break;
    case "openai-compatible":
      if (!provider.baseUrl) {
        throw new ProviderError(`provider "${name}" is openai-compatible but has no base_url`);
      }
      model = createOpenAICompatible({
        name,
        baseURL: provider.baseUrl,
        apiKey,
        fetch: http,
      })(id);
      break;
    default:
      throw new ProviderError(`unknown provider kind "${provider.kind}" for "${name}"`);
  }

  return { name, provider, model, vendor: provider.kind };
}

/** The pass provider for a given pass, honouring the session override. */
export function providerFor(
  config: Config,
  passProvider: string | null | undefined,
  override?: string | null,
): string {
  return override ?? passProvider ?? config.defaultProvider;
}
