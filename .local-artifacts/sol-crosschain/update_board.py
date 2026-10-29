import importlib.util
import pathlib
import sys

script = pathlib.Path('C:/Users/balla/.codex/skills/agent-handoff/scripts/handoff.py')
sys.path.insert(0, str(script.parent))
spec = importlib.util.spec_from_file_location('handoff', script)
handoff = importlib.util.module_from_spec(spec)
spec.loader.exec_module(handoff)
root = pathlib.Path.cwd()
done = len(sys.argv) > 1 and sys.argv[1] == 'done'
if done:
    assert (root / '.local-artifacts/sol-crosschain/verify-ci.exitcode').read_text().strip() == '0'
now = ('- SOL cross-chain source-route fix locally verified; final verify:ci passes. ' if done else
       '- SOL cross-chain source-route fix implemented; final verify:ci running. ')
now += ('Mayan6025=AmountInTooSmall proven from deployed IDL and reproduced by unsigned app-path probe; '
        'bounded alternate bridge lookup returns simulated NEAR for Base and Ethereum ETH. '
        'User Retry change preserved. docs/SOL-CROSSCHAIN.md; .local-artifacts/sol-crosschain/. '
        'No signing/broadcast/deploy/install; GitHub CI pending uncommitted/unpushed changes.')
skill = ('- SOL source-route failures -> Debugging / Fullstack Iteration / solana-wallet-core / solana-signing-security '
         '| used: program-specific decoding, unsigned simulation, bounded bridge exclusion and fail-closed route selection '
         '| Codex: C:/Users/balla/.codex/skills/ | Claude: resolve local catalog.')
pointer = ('- docs/SOL-CROSSCHAIN.md; src/main/swap-solana-crosschain.test.ts; .local-artifacts/sol-crosschain/ '
           '(deployed IDL, unsigned source logs, normal-app-path quote probes, full verification).')
with handoff.locked(root):
    board = root / 'HANDOFF.md'
    text = board.read_text(encoding='utf-8')
    lines = [line for line in text.splitlines() if not line.startswith('- SOL cross-chain source-route fix')
             and not line.startswith('- SOL source-route failures ->')
             and not line.startswith('- docs/SOL-CROSSCHAIN.md;')]
    text = '\n'.join(lines) + '\n'
    for section, entry in [('Now', now), ('Skills', skill), ('Pointers', pointer)]:
        text = text.replace(f'## {section}\n', f'## {section}\n{entry}\n', 1)
    if done:
        entry = ('- SOL routing final CI=1 verify:ci exit0 at HEAD22c10e1 plus user Retry/local fix: fiveTS, '
                 '189files2776unit, fresh desktop/extension/injection,103browser first-pass+2retry-pass(existing Sappy/downloads)+1skip. '
                 'Audit0critical5high4moderate; dependencies unchanged. Unsigned getSwapQuote proves FastMCTP6001 and Swift6025 '
                 'rejections -> NEAR passing on Base; fresh Ethereum NEAR and Base Mayan pass. Source simulation only; '
                 'no real settlement. .local-artifacts/sol-crosschain/; GitHub CI pending uncommitted/unpushed.')
        text = text.replace('## Verification status\n', '## Verification status\n' + entry + '\n', 1)
    board.write_text(text, encoding='utf-8')
