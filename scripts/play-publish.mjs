#!/usr/bin/env node
// Google Play Console automation via the Android Publisher API (v3).
//
// Why this exists: the Play Console web UI is the only other way to edit a
// listing, and it is slow and easy to get wrong. This drives the same data
// over the REST API from a service-account key, so listing copy lives in the
// repo (store/) and is reviewable in a diff like everything else.
//
// Auth is a hand-rolled RS256 JWT -> OAuth2 exchange (node:crypto only) so the
// repo does not grow a googleapis dependency for four endpoints.
//
// Setup (one time, in Play Console):
//   1. Play Console -> Users and permissions -> Invite new users -> Service account
//      (or Setup -> API access -> Create new service account, which sends you to
//      Google Cloud).
//   2. Google Cloud: create the service account, enable the "Google Play Android
//      Developer API", create a JSON key, download it.
//   3. Back in Play Console: grant that account access to THIS APP ONLY, with
//      "Edit store listing" + "Release to testing tracks" + "Manage testers".
//      Do NOT grant production release rights -- this key can publish unattended.
//   4. Save the JSON outside the repo and point PLAY_SERVICE_ACCOUNT_KEY at it.
//
// Usage:
//   node scripts/play-publish.mjs pull                     # console -> store/
//   node scripts/play-publish.mjs push-listing             # store/ -> console (dry run)
//   node scripts/play-publish.mjs push-listing --commit    # ...for real
//   node scripts/play-publish.mjs push-images --commit
//   node scripts/play-publish.mjs upload build.aab --track internal --commit
//   node scripts/play-publish.mjs tracks
//   node scripts/play-publish.mjs testers --track alpha --groups a@googlegroups.com --commit
//
// EVERY mutating command is a dry run unless you pass --commit. Without it the
// edit is created, the changes are staged, the API validates them, and the edit
// is then discarded -- so you get the API's own error messages with zero risk.

import { createSign } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

const DEFAULT_PACKAGE = 'info.chainlens.magicmoney';
const STORE_DIR = resolve(process.cwd(), 'store');

// Play's own limits. Enforced locally because the API rejects with a generic
// 400 and the console silently truncates -- neither tells you the real number.
const LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 };

// Directory name under store/<lang>/images/ -> Play imageType.
// Single-file types take one image; the rest take a numbered set.
const IMAGE_TYPES = {
  icon: { type: 'appIcon', single: true },
  featureGraphic: { type: 'featureGraphic', single: true },
  tvBanner: { type: 'tvBanner', single: true },
  phoneScreenshots: { type: 'phoneScreenshots', single: false },
  sevenInchScreenshots: { type: 'sevenInchScreenshots', single: false },
  tenInchScreenshots: { type: 'tenInchScreenshots', single: false },
  tvScreenshots: { type: 'tvScreenshots', single: false },
  wearScreenshots: { type: 'wearScreenshots', single: false },
};

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { opts._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else { opts[key] = next; i++; }
  }
  return opts;
}

function fail(msg) {
  console.error(`\n  ✖ ${msg}\n`);
  process.exit(1);
}

// ── Auth ─────────────────────────────────────────────────────────────────────

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function loadKey(opts) {
  const path = opts.key || process.env.PLAY_SERVICE_ACCOUNT_KEY;
  if (!path) {
    fail('No service-account key. Pass --key <path> or set PLAY_SERVICE_ACCOUNT_KEY.\n' +
         '    See the setup steps at the top of this file.');
  }
  if (!existsSync(path)) fail(`Service-account key not found: ${path}`);
  let key;
  try { key = JSON.parse(readFileSync(path, 'utf8')); }
  catch { fail(`Service-account key is not valid JSON: ${path}`); }
  if (!key.client_email || !key.private_key) {
    fail(`${path} is missing client_email/private_key -- is it an OAuth client\n` +
         '    secret rather than a service-account key?');
  }
  return key;
}

/** Sign a JWT with the SA key and exchange it for an access token. */
async function getAccessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = key.token_uri || 'https://oauth2.googleapis.com/token';
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: key.client_email,
    scope: SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const sig = signer.sign(key.private_key).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${sig}`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    fail(`OAuth token exchange failed (${res.status}): ${body.error_description || body.error || 'unknown'}\n` +
         '    Common causes: the Android Publisher API is not enabled on the\n' +
         '    project, or the service account has not been invited in Play Console.');
  }
  return body.access_token;
}

// ── API plumbing ─────────────────────────────────────────────────────────────

class Play {
  constructor(token, packageName) {
    this.token = token;
    this.pkg = packageName;
    this.editId = null;
  }

  async call(method, path, { body, query, base = API, contentType, raw } = {}) {
    const qs = query ? `?${new URLSearchParams(query)}` : '';
    const url = `${base}/applications/${encodeURIComponent(this.pkg)}${path}${qs}`;
    const headers = { Authorization: `Bearer ${this.token}` };
    let payload;
    if (raw !== undefined) {
      payload = raw;
      headers['Content-Type'] = contentType;
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, { method, headers, body: payload });
    const text = await res.text();
    const parsed = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!res.ok) {
      const detail = parsed?.error?.message || (typeof parsed === 'string' ? parsed : JSON.stringify(parsed));
      const err = new Error(`${method} ${path} -> ${res.status}: ${detail}`);
      err.status = res.status;
      throw err;
    }
    return parsed;
  }

  async openEdit() {
    const edit = await this.call('POST', '/edits');
    this.editId = edit.id;
    return edit.id;
  }

  edit(path) { return `/edits/${this.editId}${path}`; }

  async validate() { return this.call('POST', this.edit(':validate')); }

  async commit(noReview) {
    const query = noReview ? { changesNotSentForReview: 'true' } : undefined;
    return this.call('POST', this.edit(':commit'), { query });
  }

  async discard() {
    try { await this.call('DELETE', this.edit('')); } catch { /* edit expires on its own */ }
  }
}

/**
 * Open an edit, run `fn`, then either commit or validate-and-discard.
 * The discard path is what makes every command safe to run blind.
 */
async function withEdit(play, opts, fn) {
  await play.openEdit();
  let result;
  try {
    result = await fn(play);
    await play.validate();
  } catch (err) {
    await play.discard();
    throw err;
  }
  if (opts.commit) {
    const done = await play.commit(opts['no-review']);
    console.log(`\n  ✔ Committed edit ${done.id}. Changes are live (or queued for review).`);
  } else {
    await play.discard();
    console.log('\n  ● Dry run OK — the API accepted these changes, then they were discarded.');
    console.log('    Re-run with --commit to apply.');
  }
  return result;
}

// ── store/ layout (fastlane-supply compatible) ───────────────────────────────
//
//   store/<lang>/title.txt
//   store/<lang>/short_description.txt
//   store/<lang>/full_description.txt
//   store/<lang>/video.txt                     (optional, a YouTube URL)
//   store/<lang>/images/icon.png
//   store/<lang>/images/featureGraphic.png
//   store/<lang>/images/phoneScreenshots/1.png, 2.png, ...
//   store/<lang>/changelogs/<versionCode>.txt
//
// Deliberately mirrors fastlane's layout so switching to supply later is a
// no-op, and so anything that already reads that layout keeps working.

function listLanguages() {
  if (!existsSync(STORE_DIR)) return [];
  return readdirSync(STORE_DIR).filter((d) => statSync(join(STORE_DIR, d)).isDirectory());
}

function readField(lang, file) {
  const path = join(STORE_DIR, lang, file);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trim();
}

function writeField(lang, file, value) {
  if (value === null || value === undefined || value === '') return;
  const dir = join(STORE_DIR, lang);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), `${value}\n`, 'utf8');
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdPull(play) {
  await play.openEdit();
  try {
    const details = await play.call('GET', play.edit('/details'));
    const { listings = [] } = await play.call('GET', play.edit('/listings')) || {};

    if (!listings.length) {
      console.log('  No listings found — this app has no store listing yet.');
    }
    for (const l of listings) {
      writeField(l.language, 'title.txt', l.title);
      writeField(l.language, 'short_description.txt', l.shortDescription);
      writeField(l.language, 'full_description.txt', l.fullDescription);
      writeField(l.language, 'video.txt', l.video);
      console.log(`  ✔ store/${l.language}/  (title, short_description, full_description)`);
    }

    mkdirSync(STORE_DIR, { recursive: true });
    writeFileSync(join(STORE_DIR, 'details.json'), `${JSON.stringify(details, null, 2)}\n`, 'utf8');
    console.log(`  ✔ store/details.json  (defaultLanguage=${details.defaultLanguage}, contact info)`);
    console.log('\n  Images are NOT pulled (the API returns URLs, not files). Download any you\n' +
                '  want to keep from the console, or just re-upload from source.');
  } finally {
    await play.discard();
  }
}

async function cmdPushListing(play, opts) {
  const langs = opts.lang ? [opts.lang] : listLanguages();
  if (!langs.length) fail('No store/<lang>/ directories found. Run `pull` first to seed them.');

  // Validate lengths before opening an edit -- a local error beats a 400.
  const staged = [];
  for (const lang of langs) {
    const listing = {
      language: lang,
      title: readField(lang, 'title.txt'),
      shortDescription: readField(lang, 'short_description.txt'),
      fullDescription: readField(lang, 'full_description.txt'),
    };
    const video = readField(lang, 'video.txt');
    if (video) listing.video = video;

    for (const [field, max] of Object.entries(LIMITS)) {
      const val = listing[field];
      if (val === null) fail(`store/${lang}/ is missing ${field} — every listing field is required.`);
      if (val.length > max) {
        fail(`store/${lang}/${field} is ${val.length} chars, Play allows ${max}.\n` +
             `    Over by ${val.length - max}: "…${val.slice(max - 20, max)}|${val.slice(max, max + 20)}…"`);
      }
    }
    staged.push(listing);
  }

  return withEdit(play, opts, async () => {
    for (const listing of staged) {
      await play.call('PUT', play.edit(`/listings/${listing.language}`), { body: listing });
      console.log(`  ✔ ${listing.language}: "${listing.title}" ` +
                  `(short ${listing.shortDescription.length}/${LIMITS.shortDescription}, ` +
                  `full ${listing.fullDescription.length}/${LIMITS.fullDescription})`);
    }
  });
}

function contentTypeFor(file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  fail(`Unsupported image type "${ext}" (${file}). Play accepts PNG and JPEG.`);
}

async function cmdPushImages(play, opts) {
  const langs = opts.lang ? [opts.lang] : listLanguages();
  if (!langs.length) fail('No store/<lang>/ directories found.');

  // Collect first so a missing directory fails before anything is deleted.
  const uploads = [];
  for (const lang of langs) {
    const imgDir = join(STORE_DIR, lang, 'images');
    if (!existsSync(imgDir)) continue;
    for (const [dirName, { type, single }] of Object.entries(IMAGE_TYPES)) {
      if (single) {
        const match = ['png', 'jpg', 'jpeg']
          .map((e) => join(imgDir, `${dirName}.${e}`))
          .find(existsSync);
        if (match) uploads.push({ lang, type, files: [match] });
      } else {
        const dir = join(imgDir, dirName);
        if (!existsSync(dir)) continue;
        const files = readdirSync(dir)
          .filter((f) => /\.(png|jpe?g)$/i.test(f))
          // Numeric-aware so 10.png sorts after 9.png, not after 1.png.
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .map((f) => join(dir, f));
        if (files.length) uploads.push({ lang, type, files });
      }
    }
  }
  if (!uploads.length) fail('No images found under store/<lang>/images/.');

  return withEdit(play, opts, async () => {
    for (const { lang, type, files } of uploads) {
      // Play appends rather than replaces, so clear the slot first.
      await play.call('DELETE', play.edit(`/images/${lang}/${type}`));
      for (const file of files) {
        await play.call('POST', `/edits/${play.editId}/images/${lang}/${type}`, {
          base: UPLOAD,
          query: { uploadType: 'media' },
          raw: readFileSync(file),
          contentType: contentTypeFor(file),
        });
      }
      console.log(`  ✔ ${lang}/${type}: ${files.length} file(s) — ${files.map((f) => basename(f)).join(', ')}`);
    }
  });
}

async function cmdUpload(play, opts) {
  const file = opts._[1];
  if (!file) fail('Usage: upload <path-to.aab> [--track internal] [--commit]');
  if (!existsSync(file)) fail(`Bundle not found: ${file}`);
  if (extname(file).toLowerCase() !== '.aab') {
    fail(`Expected a .aab, got ${extname(file)}. Build one with \`npm run android:aab\`.`);
  }
  const track = opts.track || 'internal';
  const bytes = readFileSync(file);
  console.log(`  Uploading ${basename(file)} (${(bytes.length / 1e6).toFixed(1)} MB) to track "${track}"…`);

  return withEdit(play, opts, async () => {
    const bundle = await play.call('POST', `/edits/${play.editId}/bundles`, {
      base: UPLOAD,
      query: { uploadType: 'media' },
      raw: bytes,
      contentType: 'application/octet-stream',
    });
    console.log(`  ✔ Uploaded versionCode ${bundle.versionCode} (sha256 ${bundle.sha256?.slice(0, 16)}…)`);

    const release = { versionCodes: [String(bundle.versionCode)], status: opts.draft ? 'draft' : 'completed' };
    const notes = readField(opts.lang || 'en-US', join('changelogs', `${bundle.versionCode}.txt`));
    if (notes) {
      release.releaseNotes = [{ language: opts.lang || 'en-US', text: notes }];
      console.log(`  ✔ Release notes from store/${opts.lang || 'en-US'}/changelogs/${bundle.versionCode}.txt`);
    } else {
      console.log(`  ● No release notes (create store/en-US/changelogs/${bundle.versionCode}.txt to add them)`);
    }

    await play.call('PUT', play.edit(`/tracks/${track}`), { body: { track, releases: [release] } });
    console.log(`  ✔ Assigned to track "${track}" as ${release.status}`);
    return bundle;
  });
}

/**
 * Put a bundle that is ALREADY on Play onto another track.
 *
 * `upload` cannot do this: Play rejects re-uploading a versionCode it has seen
 * ("Version code N has already been used"), so promoting an internal build to
 * alpha used to mean either a throwaway versionCode bump or a trip through the
 * console. Assigning a track is just a PUT with the existing versionCode, which
 * is the same call `upload` makes after it pushes the bytes.
 *
 * Release notes are re-read from store/<lang>/changelogs/<versionCode>.txt, so
 * a track gets the same notes the first one did without retyping them.
 */
async function cmdPromote(play, opts) {
  const versionCode = opts._[1];
  const track = opts.track;
  if (!versionCode || !track) {
    fail('Usage: promote <versionCode> --track <internal|alpha|beta|production> [--commit]');
  }
  if (!/^\d+$/.test(String(versionCode))) fail(`Expected a numeric versionCode, got "${versionCode}".`);

  const lang = opts.lang || 'en-US';
  console.log(`  Assigning versionCode ${versionCode} to track "${track}"…`);

  return withEdit(play, opts, async () => {
    // Guard against a typo silently creating an empty release: the bundle has
    // to actually exist on Play before a track can point at it.
    const { bundles = [] } = await play.call('GET', play.edit('/bundles')) || {};
    if (bundles.length && !bundles.some((b) => String(b.versionCode) === String(versionCode))) {
      fail(`versionCode ${versionCode} is not uploaded to this app. ` +
           `Known: ${bundles.map((b) => b.versionCode).join(', ') || '(none)'}`);
    }

    const release = { versionCodes: [String(versionCode)], status: opts.draft ? 'draft' : 'completed' };
    const notes = readField(lang, join('changelogs', `${versionCode}.txt`));
    if (notes) {
      release.releaseNotes = [{ language: lang, text: notes }];
      console.log(`  ✔ Release notes from store/${lang}/changelogs/${versionCode}.txt`);
    } else {
      console.log(`  ● No release notes (create store/${lang}/changelogs/${versionCode}.txt to add them)`);
    }

    await play.call('PUT', play.edit(`/tracks/${track}`), { body: { track, releases: [release] } });
    console.log(`  ✔ Track "${track}" now serves versionCode ${versionCode} as ${release.status}`);
  });
}

async function cmdTracks(play) {
  await play.openEdit();
  try {
    const { tracks = [] } = await play.call('GET', play.edit('/tracks')) || {};
    if (!tracks.length) { console.log('  No tracks configured.'); return; }
    for (const t of tracks) {
      console.log(`\n  ${t.track}`);
      for (const r of t.releases || []) {
        const frac = r.userFraction ? ` @ ${(r.userFraction * 100).toFixed(0)}%` : '';
        console.log(`    ${r.status}${frac}  versionCodes=[${(r.versionCodes || []).join(', ')}]  ${r.name || ''}`);
      }
      const testers = await play.call('GET', play.edit(`/testers/${t.track}`)).catch(() => null);
      if (testers?.googleGroups?.length) {
        console.log(`    testers: ${testers.googleGroups.join(', ')}`);
      }
    }
    console.log();
  } finally {
    await play.discard();
  }
}

async function cmdTesters(play, opts) {
  const track = opts.track;
  if (!track) fail('Usage: testers --track <internal|alpha|beta> [--groups a@googlegroups.com,b@…] [--commit]');

  if (!opts.groups) {
    await play.openEdit();
    try {
      const t = await play.call('GET', play.edit(`/testers/${track}`));
      console.log(`  ${track} tester groups: ${t.googleGroups?.join(', ') || '(none)'}`);
    } finally {
      await play.discard();
    }
    return;
  }

  const groups = String(opts.groups).split(',').map((g) => g.trim()).filter(Boolean);
  return withEdit(play, opts, async () => {
    await play.call('PUT', play.edit(`/testers/${track}`), { body: { googleGroups: groups } });
    console.log(`  ✔ ${track} tester groups set to: ${groups.join(', ')}`);
    console.log('\n  Note: the API can only point a track at Google Groups. Individual\n' +
                '  tester email lists are console-only, and consumer (non-Workspace)\n' +
                '  group MEMBERSHIP has no API either — that part stays manual.');
  });
}

// ── Entry ────────────────────────────────────────────────────────────────────

const USAGE = `
  play-publish — drive the Google Play listing from the repo

  Commands
    pull                        Download the live listing into store/
    push-listing                Upload store/<lang>/*.txt
    push-images                 Upload store/<lang>/images/**
    upload <file.aab>           Upload a bundle and assign it to a track
    promote <versionCode>       Point another track at a bundle already on Play
    tracks                      Show track + tester state
    testers --track <t>         Show or set (--groups) tester Google Groups

  Options
    --commit                    Actually apply (default: validate, then discard)
    --key <path>                Service-account JSON  [env PLAY_SERVICE_ACCOUNT_KEY]
    --package <id>              Default: ${DEFAULT_PACKAGE}
    --track <name>              internal | alpha | beta | production
    --lang <code>               Limit to one language (default: all in store/)
    --draft                     Upload as a draft release instead of completed
    --no-review                 Commit with changesNotSentForReview=true
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0];
  if (!cmd || opts.help) { console.log(USAGE); process.exit(cmd ? 0 : 1); }

  const key = loadKey(opts);
  const token = await getAccessToken(key);
  const play = new Play(token, opts.package || DEFAULT_PACKAGE);
  console.log(`\n  ${play.pkg}  as  ${key.client_email}\n`);

  const commands = {
    pull: cmdPull,
    'push-listing': cmdPushListing,
    'push-images': cmdPushImages,
    upload: cmdUpload,
    promote: cmdPromote,
    tracks: cmdTracks,
    testers: cmdTesters,
  };
  const fn = commands[cmd];
  if (!fn) fail(`Unknown command "${cmd}".${USAGE}`);
  await fn(play, opts);
}

main().catch((err) => {
  if (err.status === 401 || err.status === 403) {
    fail(`${err.message}\n\n    The service account is authenticated but not authorised for this app.\n` +
         '    In Play Console -> Users and permissions, confirm it has app access\n' +
         '    plus "Edit store listing" / "Release to testing tracks".');
  }
  fail(err.message || String(err));
});