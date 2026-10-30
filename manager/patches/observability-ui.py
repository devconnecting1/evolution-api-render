#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager bundle: "Observabilidade" page (WhatsAIObservability component).

Why a patch and not a rebuild: see openai-fields.py (manager/dist is a customized minified build).

Fixes (one group, one marker comment):
  - Metrics without a limit (messages, sessions, database size...) showed an empty progress bar that read as
    "0%": clamp(null) became 0 because Number(null) === 0. Now there is no bar without a percent.
  - The percent text was clamped too: a projection at 135% of the limit read "100%". The bar stays clamped at
    100%, the text shows the real percent.
  - Resource badges were always grey: "desconectada", "sem resposta", "suspenso", failed deploys... are now red,
    "conectando"/"reconectando"/queued deploys amber, so a disconnected WhatsApp instance stands out.
  - "Configure as variáveis" (alert of missing keys) opens the "Como configurar as chaves" help instead of
    jumping to it closed; the GitHub line of the help lists GITHUB_OWNER/GITHUB_REPO and the token permissions.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: when the marker is present nothing is changed. It does NOT touch index.html (cache bust).
The changed lines are all inside the component (no edit on the long minified lines around it), so a parallel
change elsewhere in the bundle merges cleanly; after merging, re-run with --check (and apply if needed).

Usage (from the repository root):
  python3 -I manager/patches/observability-ui.py           # apply
  python3 -I manager/patches/observability-ui.py --check   # exit 1 unless applied
Validate afterwards: cp manager/dist/assets/index-*.js /tmp/x.mjs && node --check /tmp/x.mjs
"""
import glob
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
MARKER = '/*whatsai-patch:observability-ui:v1*/'


class PatchError(Exception):
    pass


def bundle_path():
    """The bundle referenced by index.html (its name can change when the Manager is rebuilt)."""
    with open(INDEX, encoding='utf-8') as fh:
        match = re.search(r'src="/assets/(index-[A-Za-z0-9_-]+\.js)', fh.read())
    if not match:
        candidates = glob.glob(os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-*.js'))
        if len(candidates) != 1:
            raise PatchError(f'bundle: expected one index-*.js, got {len(candidates)}')
        return candidates[0]
    return os.path.join(ROOT, 'manager', 'dist', 'assets', match.group(1))


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new)


START = 'const WhatsAIObservability=(()=>{'
END = "return {Page:ObservabilityPage,Redirect:ObsRedirect};"

RESOURCE_VARIANT = (
    "function resourceVariant(s){const v=String(s||'').toLowerCase();"
    "if(['desconectada','desconectado','sem resposta','suspenso','suspended','error','failed','build_failed',"
    "'update_failed','pre_deploy_failed','canceled','cancelled','unavailable'].includes(v))return 'destructive';"
    "if(['conectando','reconectando','connecting','queued','building','build_in_progress','update_in_progress',"
    "'created','initializing'].includes(v))return 'warning';return 'secondary';}"
)

REPLACEMENTS = [
    (
        'clamp(null) is "no percent", not 0',
        "function clamp(v){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(100,n)):null;}",
        "function clamp(v){if(v==null||v==='')return null;const n=Number(v);"
        "return Number.isFinite(n)?Math.max(0,Math.min(100,n)):null;}" + RESOURCE_VARIANT + MARKER,
    ),
    (
        'real percent in the text',
        "percent!=null?` · ${num(percent,0)}%`:''",
        "percent!=null?` · ${num(m.percent,0)}%`:''",
    ),
    (
        '"Configure as variáveis" opens the help (it only jumped to the closed <details>)',
        "i.jsx('a',{href:'#observability-config',className:'underline underline-offset-4',children:'Configure as variáveis'})",
        "i.jsx('a',{href:'#observability-config',className:'underline underline-offset-4',onClick:e=>{"
        "const d=document.getElementById('observability-config');if(d){e.preventDefault();d.open=true;"
        "d.scrollIntoView({behavior:'smooth',block:'start'});}},children:'Configure as variáveis'})",
    ),
    (
        'GitHub help lists every variable and permission',
        "i.jsx('p',{children:'• GitHub: GITHUB_TOKEN com permissão de billing (opcional).'})",
        "i.jsx('p',{children:'• GitHub (opcional): GITHUB_TOKEN (fine-grained, Actions: read e Plan: read) e, "
        "para outro repositório, GITHUB_OWNER e GITHUB_REPO.'})",
    ),
    (
        'resource badge colour by status',
        "r.status?i.jsx(vu,{variant:'secondary',children:r.status}):null",
        "r.status?i.jsx(vu,{variant:resourceVariant(r.status),children:r.status}):null",
    ),
]


def patch(source):
    start = source.find(START)
    end = source.find(END, start)
    if source.count(START) != 1 or end < 0:
        raise PatchError('component: WhatsAIObservability not found exactly once')
    component = source[start:end]
    if MARKER in component:
        return source, False
    for label, old, new in REPLACEMENTS:
        component = rep(component, old, new, label)
    return source[:start] + component + source[end:], True


def main():
    check = '--check' in sys.argv[1:]
    path = bundle_path()
    with open(path, encoding='utf-8') as fh:
        source = fh.read()
    applied = MARKER in source
    if check:
        print(f'observability-ui: {"applied" if applied else "NOT applied"} ({os.path.basename(path)})')
        return 0 if applied else 1
    try:
        patched, changed = patch(source)
    except PatchError as error:
        print(f'observability-ui: {error}; nothing written', file=sys.stderr)
        return 2
    if changed:
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(patched)
    print(f'observability-ui: {"applied" if changed else "already applied"} ({os.path.basename(path)})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
