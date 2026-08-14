/// <reference types="vite/client" />

/**
 * Compile-time flag injected by `define` in vite.ios.config.ts, driven by the
 * CAP_WEB_DEBUG env var. True only in the CI job that runs the in-app
 * self-check; a literal `false` everywhere else, which lets Rollup drop the
 * self-check module entirely from release bundles.
 */
declare const __MM_SELF_CHECK__: boolean
