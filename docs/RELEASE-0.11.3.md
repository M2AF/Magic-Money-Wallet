# Magic Money 0.11.3

- Expanded Cardano swaps with Minswap V2, SundaeSwap V3, and NEAR Intents routes, including multi-step cross-chain transfers and swap history.
- Native agent execution and x402 support across EVM, Solana, and Cardano, with bounded approvals and recovery controls.
- Improved Solana cross-chain route handling and retry behavior.
- Midnight, chat, and profile synchronization fixes.

## Downloads

Windows, macOS, Linux, Android, and Chrome extension. This release does not include iOS.

## Release preparation

- Version: 0.11.3; Android versionCode: 29.
- Source baseline: 1118b177f5eac23756cdc7da7c0ce34303e18d9d.
- CI and Release run `verify:ci`: typechecks, unit tests, fresh desktop build, extension/injection builds, one-worker Playwright, and critical production dependency audit.
- Publish only after matching main CI succeeds. The release workflow keeps all downloads in a draft until all 11 required asset patterns are present.
- Route availability depends on live provider support and liquidity. Automated checks do not establish real-funds settlement or production Worker deployment.
