/**
 * adblock-rs.d.ts — MagicMoney Wallet
 *
 * Hand-written declarations for the `adblock-rs` native Node addon (pinned to
 * 0.13.2 — see package.json). No published/DefinitelyTyped types match this
 * version's actual JS binding shape, so these are transcribed directly from the
 * addon's own source (js/index.js + js/src/lib.rs in the adblock-rs 0.13.2
 * tarball) and its integration tests (js/test/bindings.test.mjs), NOT guessed.
 *
 * Declares only the surface Magic Guard actually uses (Batch A spike: FilterSet
 * construction/parsing + Engine construction/check). Extend this file — from the
 * same source-of-truth — if a later batch needs more of the API (cosmetics,
 * serialization, resources, tags).
 */
declare module 'adblock-rs' {
  export interface AddedFiltersRecord {
    source_index: number
    metadata: {
      title?: string
      homepage?: string
      expires?: number | null
      redirect?: string
    }
  }

  /**
   * Runtime values are the Rust enum variant names verbatim (plain serde
   * derive, no rename) — transcribed from node_modules/adblock-rs/src/lists.rs
   * RuleTypes + js/src/lib.rs build_rule_types_enum, not guessed.
   */
  export const RuleTypes: {
    ALL: 'All'
    NETWORK_ONLY: 'NetworkOnly'
    COSMETIC_ONLY: 'CosmeticOnly'
  }

  export interface AddFiltersOptions {
    rule_types?: 'All' | 'NetworkOnly' | 'CosmeticOnly'
  }

  export class FilterSet {
    constructor(debug?: boolean)
    /** `rules` is a single newline-separated filter list string (ABP/uBlock syntax). */
    addFilters(rules: string, options?: AddFiltersOptions): AddedFiltersRecord
  }

  export class Engine {
    constructor(filterSet: FilterSet)
    /**
     * Returns whether the request should be blocked. `requestType` is an
     * adblock-rust request-type alias (e.g. 'document', 'script', 'image',
     * 'xmlhttprequest', 'other' — see the resource-type mapping table in
     * MAGIC_GUARD_IMPLEMENTATION_PLAN.md). `method` is an HTTP method string;
     * omit or pass '' when unspecified.
     */
    check(url: string, sourceUrl: string, requestType: string, method?: string): boolean
  }
}
