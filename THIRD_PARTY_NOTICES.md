# Third-Party Notices — Magic Guard

Magic Guard (the built-in dApp browser's privacy filtering feature) bundles third-party
software and data. This file documents what, under what license, and where.

## adblock-rs / adblock-rust

- **What:** the filtering engine (Rust crate `adblock`, Node binding `adblock-rs`,
  pinned to `0.13.2` in `package.json`).
- **Source:** https://github.com/brave/adblock-rust
- **License:** Mozilla Public License 2.0 (MPL-2.0). Full text:
  `node_modules/adblock-rs/LICENSE` at build time.
- **Modifications:** none. Magic Money uses the published package unmodified.
- Magic Guard is not part of Brave Shields and is not affiliated with or endorsed
  by Brave Software. `adblock-rust` is one filtering engine used by Brave; using it
  does not imply Brave Shields feature parity.

## EasyList

- **What:** network filter rules bundled at `resources/magic-guard/easylist.txt`.
- **Source:** https://easylist.to/easylist/easylist.txt
- **License:** GPLv3-or-later, or CC BY-SA 3.0-or-later, at the licensee's option
  (dual-licensed) — see https://easylist.to/pages/licence.html
- **Modifications:** none. Snapshot fetched verbatim; see
  `resources/magic-guard/manifest.json` for the exact source URL, upstream
  version/commit, SHA-256, and download timestamp of the bundled copy.

## EasyPrivacy

- **What:** privacy/tracker filter rules bundled at
  `resources/magic-guard/easyprivacy.txt`.
- **Source:** https://easylist.to/easylist/easyprivacy.txt
- **License:** same dual license as EasyList — see
  https://easylist.to/pages/licence.html
- **Modifications:** none. Snapshot fetched verbatim; see
  `resources/magic-guard/manifest.json` for provenance.

## Magic Money-owned compatibility list

- `resources/magic-guard/magicmoney-unbreak.txt` is written by the Magic Money
  team, not a third-party list, and carries the project's own license.

---

Snapshot updates are deterministic and reviewed like source changes — see
`resources/magic-guard/manifest.json` and MAGIC_GUARD_IMPLEMENTATION_PLAN.md
section 6. This file is an engineering checklist, not legal advice; the release
owner is responsible for confirming license compatibility before distribution
(plan section 17).
