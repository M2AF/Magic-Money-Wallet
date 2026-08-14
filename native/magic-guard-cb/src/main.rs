//! magic-guard-cb — EasyList/EasyPrivacy → Apple content-blocking JSON.
//!
//! WKWebView has no `shouldInterceptRequest`, so the Rust matching engine that
//! powers Magic Guard on Android and desktop cannot run per-request on iOS.
//! WebKit's answer is `WKContentRuleList`: a declarative JSON ruleset compiled
//! once and evaluated inside the engine. This binary produces that JSON.
//!
//! The conversion itself is `adblock-rust`'s own `into_content_blocking()` —
//! the same code Brave iOS uses — rather than a hand-written translator, which
//! would have to reimplement option parsing, domain anchoring and
//! exception-ordering semantics correctly.
//!
//! Output is COMMITTED to resources/magic-guard/ios/, not generated during the
//! app build: the source lists change only when someone deliberately updates
//! them, and committing the result keeps Rust off the critical path of every
//! iOS build. Regenerate with `npm run magic-guard:ios`.
//!
//! Usage: magic-guard-cb <lists-dir> <out-dir>

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use adblock::content_blocking::CbType;
use adblock::lists::{FilterFormat, FilterSet, ParseOptions};
use flate2::write::DeflateEncoder;
use flate2::Compression;
use sha2::{Digest, Sha256};

/// WebKit hard-fails compilation past 150,000 rules in a single list. Chunking
/// well below that keeps each list comfortably compilable (and lets a single
/// oversized list be swapped without touching the others) — WKWebView accepts
/// any number of separately compiled lists attached to one configuration.
const MAX_RULES_PER_CHUNK: usize = 40_000;

/// Order matters: the unbreak list must be added LAST so its exception rules
/// land after the block rules they countermand. `into_content_blocking()`
/// preserves ordering for `ignore-previous-rules` semantics.
const LISTS: &[&str] = &["easylist.txt", "easyprivacy.txt", "magicmoney-unbreak.txt"];

fn main() {
    let mut args = std::env::args().skip(1);
    let lists_dir = PathBuf::from(args.next().unwrap_or_else(|| usage()));
    let out_dir = PathBuf::from(args.next().unwrap_or_else(|| usage()));

    // debug = true is REQUIRED: into_content_blocking() returns Err on a
    // FilterSet built without it, because it needs the original rule text.
    let mut filter_set = FilterSet::new(true);
    let mut added = 0usize;

    for name in LISTS {
        let path = lists_dir.join(name);
        match fs::read_to_string(&path) {
            Ok(text) => {
                let lines = text.lines().count();
                filter_set.add_filter_list(text, ParseOptions {
                    format: FilterFormat::Standard,
                    ..Default::default()
                });
                println!("  + {name}: {lines} lines");
                added += lines;
            }
            Err(e) => {
                eprintln!("  ! skipping {name}: {e}");
            }
        }
    }

    if added == 0 {
        eprintln!("magic-guard-cb: no filter rules were read from {}", lists_dir.display());
        std::process::exit(1);
    }

    let (rules, unsupported) = match filter_set.into_content_blocking() {
        Ok(v) => v,
        Err(()) => {
            eprintln!("magic-guard-cb: content-blocking conversion failed");
            std::process::exit(1);
        }
    };

    println!(
        "\n  converted {} rules ({} could not be represented in content-blocking format)",
        rules.len(),
        unsupported.len()
    );

    fs::create_dir_all(&out_dir).expect("could not create output directory");

    let chunks: Vec<_> = rules.chunks(MAX_RULES_PER_CHUNK).collect();
    let mut manifest_chunks = Vec::new();
    let mut hasher = Sha256::new();

    for (i, chunk) in chunks.iter().enumerate() {
        let file_name = format!("rules-{i}.json.deflate");
        let json = serde_json::to_string(chunk).expect("serialization failed");
        hasher.update(json.as_bytes());

        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(json.as_bytes()).expect("deflate failed");
        let compressed = encoder.finish().expect("deflate failed");

        let path: &Path = &out_dir.join(&file_name);
        fs::write(path, &compressed).expect("could not write ruleset");
        println!(
            "  → {file_name}: {} rules, {} KB raw → {} KB deflated",
            chunk.len(),
            json.len() / 1024,
            compressed.len() / 1024
        );
        manifest_chunks.push(serde_json::json!({
            "file": file_name,
            "rules": chunk.len(),
            // Apple's compression_decode_buffer needs a destination buffer
            // sized up front — it has no streaming "grow as needed" mode.
            "rawBytes": json.len(),
        }));
    }

    // The Swift side keys its WKContentRuleListStore identifiers on this
    // version, so regenerating the lists invalidates WebKit's compiled cache
    // instead of silently serving stale rules.
    let version = format!("{:x}", hasher.finalize())[..16].to_string();

    // A path fragment the shipped ruleset genuinely blocks, so the iOS
    // self-check can PROVE blocking rather than merely proving the lists
    // compiled. Derived from the generated rules, so it can never drift from
    // what actually ships.
    //
    // Requirements, each load-bearing:
    //  • action `block` with NO trigger conditions at all — a `load-type:
    //    third-party` or `resource-type` restriction would not fire for the
    //    top-level navigation the self-check performs.
    //  • a pure literal (no regex metacharacters), so the self-check can append
    //    it to a control host and be certain the pattern matches.
    // ~100k of the ~109k block rules are unconditional and ~400 are pure
    // literals, so this is not a fragile search.
    const META: &[char] = &['\\', '^', '$', '.', '|', '?', '*', '+', '(', ')', '[', ']', '{', '}'];
    let sample_blocked_path = rules.iter().find_map(|r| {
        if !matches!(r.action.typ, CbType::Block) { return None; }
        let t = &r.trigger;
        if t.if_domain.is_some() || t.unless_domain.is_some() { return None; }
        if t.if_top_url.is_some() || t.unless_top_url.is_some() { return None; }
        if t.resource_type.is_some() || !t.load_type.is_empty() { return None; }
        if t.url_filter_is_case_sensitive.unwrap_or(false) { return None; }

        let f = &t.url_filter;
        if f.len() < 12 || !f.starts_with('/') || !f.ends_with('/') { return None; }
        if f.chars().any(|c| META.contains(&c)) { return None; }
        if !f.chars().all(|c| c.is_ascii_alphanumeric() || "._-/".contains(c)) { return None; }
        Some(f.clone())
    });

    match &sample_blocked_path {
        Some(p) => println!("  sample blocked path for the iOS self-check: {p}"),
        None => eprintln!("  ! no pure-literal unconditional block rule found — self-check will skip the blocking test"),
    }

    let manifest = serde_json::json!({
        "generatedBy": "native/magic-guard-cb",
        "engine": "adblock-rust 0.13.2 (content-blocking)",
        "version": version,
        "totalRules": rules.len(),
        "unsupportedRules": unsupported.len(),
        "sampleBlockedPath": sample_blocked_path,
        "chunks": manifest_chunks,
    });
    fs::write(out_dir.join("manifest.json"), serde_json::to_string_pretty(&manifest).unwrap())
        .expect("could not write manifest");

    println!("\n  wrote {} chunk(s) to {}", chunks.len(), out_dir.display());
}

fn usage() -> ! {
    eprintln!("usage: magic-guard-cb <lists-dir> <out-dir>");
    std::process::exit(2);
}
