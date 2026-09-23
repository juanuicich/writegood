/** Resolving a provider name from `config.toml`.
 *
 *  The call itself happens in Rust (`llm.rs` for the network, `runner.rs` for
 *  the `cli` kind). This module only decides which provider a pass uses and
 *  reports the mistakes that can be seen without asking anyone: a name that is
 *  not in the config. Everything else — a missing key, a missing model, a
 *  base URL an openai-compatible provider needs — is Rust's to report, because
 *  Rust is what tries. */
import type { Config, Provider } from "../ipc";
import { pooled, type Limit } from "../passes/limit";

export class ProviderError extends Error {}

export interface Resolved {
  name: string;
  provider: Provider;
  /** Used to warn when the judge shares a vendor with the pass (SPEC 11). */
  vendor: string;
}

export function providerNames(config: Config): string[] {
  return Object.keys(config.providers);
}

export function resolve(config: Config, name: string): Resolved {
  const provider = config.providers[name];
  if (!provider) {
    const known = providerNames(config).join(", ") || "none";
    throw new ProviderError(`no provider named "${name}" in config.toml — have: ${known}`);
  }
  const vendor = provider.kind === "cli" ? `cli:${provider.command ?? "?"}` : provider.kind;
  return { name, provider, vendor };
}

/** The provider for a given pass, honouring the session override. */
export function providerFor(
  config: Config,
  passProvider: string | null | undefined,
  override?: string | null,
): string {
  return override ?? passProvider ?? config.defaultProvider;
}

/** The call limits of a run: one per provider, set by its `max_in_flight`,
 *  under the run's own `bound` (SPEC §8.3). A name with no provider gets the
 *  run's limit alone; the pass reports the missing name. */
export function callLimits(config: Config, bound: number): (name: string) => Limit {
  return pooled(bound, (name) => config.providers[name]?.maxInFlight);
}
