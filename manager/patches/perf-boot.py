#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager: lighter first visit (proposal S).

The panel is a single ~1.5 MB bundle without dynamic imports, so route-level JS splitting is not possible without
the source build. Without touching src/, the first visit still gets three safe wins:

1. boot    - index.html carries a static boot screen (brand, "Carregando o painel…" and a thin bar) inside #root,
             styled by /assets/boot.css. React clears #root on its first render, so the screen disappears by itself;
             no inline script, so the CSP is unchanged. The "demorando" hint (reload link) only becomes visible after
             12 s, so a normal load never shows it and a stuck bundle is not a blank page.
2. fonts   - /.well-known/vercel.json now marks /assets/* as immutable (one year). The only asset without ?v= was
             the Geist font: its URL gets ?v=FONT_VERSION here (geist.css and the index.html preload stay in sync).
             Future font changes bump FONT_VERSION; future CSS/JS changes already bump their own ?v=.
3. html    - links /assets/boot.css after the last patch stylesheet and raises the bundle ?v= to CACHE_VERSION.

The static caching itself lives in manager/dist/vercel.json and is covered by test/unit/security.test.ts through the
CSP test; there is no script to apply for it.

Every anchor must match exactly once, otherwise the script stops without writing anything.
Re-running is safe: groups whose marker is present are skipped. Order: after first-run.py.
Any edit to assets/boot.css needs BOOT_VERSION bumped (and a matching ?v= in index.html).

Usage (from the repository root):
  python3 -I manager/patches/perf-boot.py           # apply
  python3 -I manager/patches/perf-boot.py --check   # exit 1 unless every group is applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DIST = os.path.join(ROOT, 'manager', 'dist')
BUNDLE = os.path.join(DIST, 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(DIST, 'index.html')
BOOT_CSS = os.path.join(DIST, 'assets', 'boot.css')
GEIST_CSS = os.path.join(DIST, 'assets', 'geist.css')
CACHE_VERSION = '61'
BOOT_VERSION = '1'
FONT_VERSION = '1'
GEIST_VERSION = '3'
GEIST_PAGES = ('404.html', 'acesso/index.html', 'observability/index.html')
# index.html is handled by patch_index; these are the other pages that preload the font.
FONT_PAGES = (
    '404.html',
    'acesso/index.html',
    'observability/index.html',
    'landing/index.html',
    'landing/seguranca.html',
    'landing/privacidade.html',
    'landing/termos.html',
)
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
BOOT_TAG = '<link rel="stylesheet" href="/assets/boot.css?v=' + BOOT_VERSION + '" />'
HTML_MARKER = '<!-- whatsai-patch:perf-boot:html -->'
BOOT_MARKER = '/*whatsai-patch:perf-boot:boot*/'
FONT_MARKER = '/*whatsai-patch:perf-boot:font*/'
FONT_URL_RE = re.compile(r'(/assets/fonts/geist-[a-z-]+\.woff2)(?:\?v=(\d+))?')


class PatchError(Exception):
    pass


def rep(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise PatchError(f'{label}: anchor expected once, got {n}')
    return s.replace(old, new, 1)


def ensure_marker(text, marker):
    return text if marker in text else marker + '\n' + text


def bump_ref(html, asset, version, label):
    """Raise ?v= of asset to version. Accepts the tag with no version yet; never lowers an existing version."""
    pattern = re.compile('"' + re.escape(asset) + r'\?v=(\d+)"')
    found = pattern.search(html)
    if found:
        if int(found.group(1)) < int(version):
            return html[:found.start(1)] + version + html[found.end(1):]
        return html
    unversioned = '"' + asset + '"'
    n = html.count(unversioned)
    if n == 1:
        return html.replace(unversioned, '"' + asset + '?v=' + version + '"', 1)
    raise PatchError(f'{label}: expected one {asset} reference, got {n}')


def bump_bundle(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag expected once')
    start = pos + len(SCRIPT_TAG)
    end = start
    while end < len(html) and html[end].isdigit():
        end += 1
    current = html[start:end]
    if not current:
        raise PatchError('index.html: bundle version missing')
    if int(current) < int(CACHE_VERSION):
        html = html[:start] + CACHE_VERSION + html[end:]
    return html


SKELETON = (
    '    <div id="root">\n'
    '      <div id="wa-boot" class="wa-boot" role="status" aria-live="polite">\n'
    '        <span class="wa-boot-brand" aria-hidden="true">WhatsAI</span>\n'
    '        <p class="wa-boot-text">Carregando o painel…</p>\n'
    '        <span class="wa-boot-bar" aria-hidden="true"><span class="wa-boot-bar-fill"></span></span>\n'
    '        <p class="wa-boot-hint">Está demorando mais que o normal. <a href="">Recarregar a página</a>.</p>\n'
    '      </div>\n'
    '    </div>'
)
ROOT_EMPTY = '    <div id="root"></div>'


def patch_index(html):
    html = bump_bundle(html)
    if HTML_MARKER not in html:
        if '/assets/boot.css' in html:
            raise PatchError('index.html: boot.css present without the perf-boot marker; edit the file by hand')
        anchor = '    <script src="/assets/client-portal.js'
        if html.count(anchor) != 1:
            raise PatchError('index.html: client-portal.js script line expected once')
        html = html.replace(anchor, '    ' + HTML_MARKER + '\n    ' + BOOT_TAG + '\n' + anchor, 1)
    else:
        html = bump_ref(html, '/assets/boot.css', BOOT_VERSION, 'index.html boot.css')
    if SKELETON not in html:
        html = rep(html, ROOT_EMPTY, SKELETON, 'index.html empty #root')
    html = bump_ref(html, '/assets/geist.css', GEIST_VERSION, 'index.html geist.css')
    html = patch_font_preload(html, 'index.html')
    return html


def patch_page(html, name):
    if '/assets/geist.css' not in html:
        return html
    return bump_ref(html, '/assets/geist.css', GEIST_VERSION, name + ' geist.css')


def patch_font_preload(html, name):
    if '/assets/fonts/geist-' not in html:
        return html
    return bump_ref(html, '/assets/fonts/geist-latin-wght-normal.woff2', FONT_VERSION, name + ' font preload')


def patch_geist_css(css):
    css = ensure_marker(css, FONT_MARKER)

    def versioned(match):
        current = int(match.group(2) or 0)
        return match.group(1) + '?v=' + str(max(current, int(FONT_VERSION)))

    return FONT_URL_RE.sub(versioned, css)


def patch_boot_css(css):
    return ensure_marker(css, BOOT_MARKER)


def read(path):
    with open(path, encoding='utf-8') as handle:
        return handle.read()


def write(path, text):
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(text)


def main():
    check = '--check' in sys.argv[1:]
    try:
        index = read(INDEX)
        new_index = patch_index(index)
        pages = {name: read(os.path.join(DIST, name)) for name in GEIST_PAGES}
        new_pages = {name: patch_page(html, name) for name, html in pages.items()}
        geist = read(GEIST_CSS)
        new_geist = patch_geist_css(geist)
        boot = read(BOOT_CSS)
        new_boot = patch_boot_css(boot)
    except FileNotFoundError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        return 1

    missing = []
    if new_index != index:
        missing.append('index.html')
    for name in GEIST_PAGES:
        if new_pages[name] != pages[name]:
            missing.append(name)
    if new_geist != geist:
        missing.append('assets/geist.css')
    if new_boot != boot:
        missing.append('assets/boot.css')

    if check:
        print('ok: all groups applied' if not missing else f'missing: {missing}')
        return 0 if not missing else 1

    wrote = []
    if new_index != index:
        write(INDEX, new_index)
        wrote.append('index.html')
    for name in GEIST_PAGES:
        if new_pages[name] != pages[name]:
            write(os.path.join(DIST, name), new_pages[name])
            wrote.append(name)
    if new_geist != geist:
        write(GEIST_CSS, new_geist)
        wrote.append('assets/geist.css')
    if new_boot != boot:
        write(BOOT_CSS, new_boot)
        wrote.append('assets/boot.css')
    print('perf-boot: ' + (', '.join(wrote) if wrote else 'already applied'))
    print(f'index.html: bundle ?v>={CACHE_VERSION}, boot.css ?v={BOOT_VERSION}, geist.css ?v={GEIST_VERSION}, font ?v={FONT_VERSION}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'patch failed, nothing written: {error}', file=sys.stderr)
        sys.exit(1)
