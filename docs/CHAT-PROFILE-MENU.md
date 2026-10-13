# Messenger profile actions

Chat profile pictures open a menu in World Chat, direct messages, and friend and
incoming-request lists. View Profile links to
`https://www.chainlensnft.info/<ChainLens ID>` using the platform's browser bridge.
Own pictures offer View Profile without friendship or moderation actions.

The friendship menu reads the existing ChainLens relationship endpoint. Accepted
friends offer Remove Friend; strangers offer Add Friend; pending requests offer
Accept/Decline or Cancel. Actions re-read server state and refresh friends/unread
counts. Block/Unblock uses the shared moderation rows and refreshes the feed;
local filtering prevents an in-flight pre-block poll from restoring that user.
Report opens a form for spam, harassment, impersonation or other, with up to
1,000 characters of context. Only explicit submission sends a report. Failed
reports/blocks show errors without claiming success.

The menu uses a body portal, measured viewport bounds and keyboard navigation;
Escape restores focus, outside clicks close it, and the report dialog traps focus.
Session tokens stay in the privileged chat client. UUID, block-flag and report
validation runs before authentication. Existing backend authorization, ownership,
block checks and report limits remain authoritative. No backend/schema change,
dependency upgrade, signing change or deployment is part of this task.

Local validation complete: 27 focused chat unit tests, five TypeScript targets,
fresh Electron build and a real Electron/preload IPC browser journey pass.
The journey covers all relationship states, own-action exclusion, exact profile
link, block/report failures and success, feed removal/restoration, friends/DMs,
keyboard/focus and narrow viewport bounds. Reviewed previews are in
`.local-artifacts/chat-menu/`; focused logs are
`.local-artifacts/chat-menu-focus-guard.log` and `.local-artifacts/chat-menu-build-final.log`.
Tab/Shift+Tab remain in the report dialog during a deliberately held submission,
including when all form controls are disabled. The initial full gate was
superseded before its tour completed to include this guard.
Final `CI=1 npm run verify:ci` exits zero: 174 files/2,525 unit tests, fresh
Electron/extension/inject builds, 93 browser passes, one existing skip, no retries,
and the critical production audit gate. Existing four moderate/four high audit
findings remain unchanged; no dependencies changed. The complete log is
`.local-artifacts/chat-menu-final-verify-ci.log`. Ten suite-generated tracked PNGs
were archived under the menu evidence directory and committed originals restored.
GitHub CI remains **pending for uncommitted wallet changes** on base `b11a019`;
its green [base run](https://github.com/M2AF/Magic-Money-Wallet/actions/runs/38290711616)
does not verify this working tree. No agent commit, push, deployment or install
occurred. Use the rebuilt wallet/preload/main together; native runtime checks and
production authenticated friend/moderation integration remain separate from local
fixture-backed validation.

## Development runtime follow-up

The user's renderer hot-reloaded the menu while Electron main was still the
process started October 12 at 22:56. That old process lacked `chat:relationship`
and retained the old profile snapshot. Rebuilding output files did not replace
the already loaded main module. Closing the wallet window hides it to the tray,
so reopening it also kept the old backend alive.

The old development session was replaced with a fresh main/preload using the
same wallet data; the user confirmed both the menu and header picture now work.
`npm run dev` now includes `--watch` so main/preload changes rebuild and reload
along with the renderer. The installed electron-vite implementation restarts
Electron on main rebuild and reloads the renderer on preload rebuild.

The Electron regression now invokes all three real profile-action IPC handlers
before installing fixture overrides. Without a test wallet it expects the real
`No wallet address.` error, so a missing handler cannot be hidden by mocks.
The focused journey passes; the final full gate is running in
`.local-artifacts/dev-watch-verify-ci.log`. Real dev startup logs are
`.local-artifacts/development-watch*.log`. No wallet install or deployment occurred.
