/** Resolving a provider name from `config.toml`.
 *
 *  The call itself happens in Rust (`llm.rs` for the network, `runner.rs` for
 *  the `cli` kind). This module only decides which provider a pass uses and
 *  reports the mistakes that can be seen without asking anyone: a name that is
 *  not in the config. Everything else — a missing key, a missing model, a
 *  base URL an openai-compatible provider needs — is Rust's to report, because
 *  Rust is what tries. */
import type { Config, Pass, Provider } from "../ipc";
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

/** The provider for a given pass, honouring the session override (SPEC
 *  §9.1). An override that names a jev provider applies only to a
 *  paragraph-scope pass with a `[jev]` table, because Jev can run no other
 *  pass. An override that names any other provider applies to every pass,
 *  because every pass file is also a prompt. */
export function providerFor(
  config: Config,
  pass: Pick<Pass, "provider" | "scope" | "jev">,
  override?: string | null,
): string {
  if (override) {
    const jev = config.providers[override]?.kind === "jev";
    if (!jev || (pass.scope === "paragraph" && pass.jev)) return override;
  }
  return pass.provider ?? config.defaultProvider;
}

/** The call limits of a run: one per provider, set by its `max_in_flight`,
 *  under the run's own `bound` (SPEC §8.3). A name with no provider gets the
 *  run's limit alone; the pass reports the missing name. */
export function callLimits(config: Config, bound: number): (name: string) => Limit {
  return pooled(bound, (name) => config.providers[name]?.maxInFlight);
}
