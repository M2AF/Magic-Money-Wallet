import hashlib, json, pathlib, shutil, subprocess, sys
root = pathlib.Path(__file__).resolve().parents[2]
evidence = root / '.local-artifacts' / 'sol-crosschain'
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
manifest = evidence / 'generated-originals.json'
if sys.argv[1] == 'backup':
    paths = [p for p in subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0') if p.lower().endswith('.png')]
    paths.append('src/renderer/data/app-hub.ts')
    entries = []
    for relative in paths:
        source = (root / relative).resolve()
        assert source.is_relative_to(root)
        destination = evidence / 'originals' / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        entries.append({'path': relative, 'sha256': digest(source)})
    manifest.write_text(json.dumps(entries, indent=2))
    print('Preserved', len(entries), 'tracked generated assets')
else:
    entries = json.loads(manifest.read_text())
    changes = []
    for item in entries:
        target = (root / item['path']).resolve()
        assert target.is_relative_to(root)
        original = evidence / 'originals' / item['path']
        assert digest(original) == item['sha256']
        if not target.exists() or digest(target) != item['sha256']:
            generated = evidence / 'generated' / item['path']
            generated.parent.mkdir(parents=True, exist_ok=True)
            if target.exists(): shutil.copyfile(target, generated)
            shutil.copyfile(original, target)
            changes.append(item['path'])
        assert digest(target) == item['sha256']
    (evidence / 'generated-restoration.json').write_text(json.dumps({'verified': len(entries), 'restored': changes}, indent=2))
    print('Verified', len(entries), 'assets; restored', len(changes))


