# NFT profile pictures

Implementation and full changed-file/validation details are in the companion
ChainLens checkout: `../chainlens/docs/NFT-PROFILE-PICTURES.md` relative to this
repository root.

The wallet shares its loaded Portfolio inventory with Profile's scrollable,
searchable NFT picker, excludes hidden/spam entries, and offers Use as profile
picture in NFT details. NFT avatar identities sync through `avatar_nft_key` on the
existing profile; hexagonal animated borders distinguish them from circular
uploaded photos across Profile and Messenger. Existing pictures need NFT
reselection to establish their source. Reduced-motion preferences stop animation.

The extension/Capacitor profile-save path now resolves the profile UUID before
updating it. The Worker uses the existing wallet signature plus verified-link
membership, supporting accounts created through Solana/social login while denying
watch-only and unrelated-profile writes. No transaction/signing pipeline changed.

Shared database migration applied from ChainLens. App/Worker deployment, wallet
release/install and production authenticated synchronization remain separate from
local validation. GitHub CI is pending for these uncommitted changes; the green
base run for `b11a019` does not verify them. Final local `CI=1 npm run verify:ci`
exits zero: five TypeScript targets, 174 files/2,517 unit tests, fresh builds,
92 browser passes/one existing skip and the required critical production audit
pass. `.nft-avatar-verify-ci-reviewed.log`. Five focused avatar/gallery journeys
also pass without retries. Wallet picker/profile previews reviewed in
`.local-artifacts/nft-avatar/`. Existing dependencies retain four moderate/four
high audit findings; no dependencies changed.

## Chat sizing and header refresh follow-up (2026-10-12)

Messenger message, friend-list and header avatars are now 40px. The animated
NFT-border layer is contained inside its avatar instead of contributing to
horizontal feed overflow; GIFs, unbroken text and headers fit the available width.
The Electron tour checks an own-message NFT against the right edge at
390/420/768px, a 500-character message, and the DM feed.

`chatStatus()` refreshes the displayed profile when Messenger opens with an
existing session. This prevents a picture changed on ChainLens from remaining
stale until the day-long session expires. It reuses the token and does not repeat
profile lookups on three-second message polls. An account-ID mismatch clears the
session instead of attaching another profile to it. Three new unit regressions
cover fresh NFT identity, uploaded/removed pictures and account separation.
Final `CI=1 npm run verify:ci` exits zero: five TypeScript targets,
174 files/2,520 unit tests, fresh Electron/extension/inject builds, 91 browser
passes, one unrelated browser-history case passing on retry, one existing skip,
and the required critical audit gate. Existing four moderate/four high dependency
findings remain unchanged. The history fixture reads the old visit title before
its repeat counter updates (expected 2, received 1 on the first attempt).
Evidence: `.local-artifacts/chat-sizing-final-verify-ci.log` and reviewed previews
in `.local-artifacts/chat-sizing/`. Ten generated tracked PNGs were archived and
originals restored. GitHub CI is pending for uncommitted wallet changes; the green
base `b11a019` run does not verify them. Deployment, updated wallet distribution
and device installation remain separate from local validation. A running wallet
must use the rebuilt main process to pick up the header refresh.
