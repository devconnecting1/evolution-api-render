#!/usr/bin/env python3
"""Deterministic patch of the WhatsAI Manager bundle: the old in-app home page never shows again.

The Manager SPA still had a route "/" rendering an old home page (Fse: "Atendimento com IA no WhatsApp, sem perder o
toque humano"). Vercel serves the real landing (landing/index.html) at "/" on a full page load, but navigations INSIDE
the SPA ended on that old page:
- /manager/login opened while already logged in redirected to "/" (public-route guard), so a logged-in user who
  opened the login page saw the old home;
- any other client-side navigation to "/".

Now the guard sends a logged-in user to /manager/ (instances), and the "/" route does a full page load of "/" so
Vercel serves the real landing. Loop guard: if a second redirect happens within 5 s (e.g. the server ever served the
SPA at "/"), it goes to /manager/ instead.

Same method as the other scripts in manager/patches: exact string replacements; each anchor must match exactly once
or nothing is written. Re-running is safe. Applying also bumps the bundle ?v= in index.html (only raised).
Order: run after twenty-layout.py.

Usage (from the repository root):
  python3 -I manager/patches/root-redirect.py           # apply
  python3 -I manager/patches/root-redirect.py --check   # exit 1 unless applied
Validate afterwards: npx esbuild manager/dist/assets/index-b29a5d7a.js --log-level=error --format=esm > /dev/null
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUNDLE = os.path.join(ROOT, 'manager', 'dist', 'assets', 'index-b29a5d7a.js')
INDEX = os.path.join(ROOT, 'manager', 'dist', 'index.html')
SCRIPT_TAG = '/assets/index-b29a5d7a.js?v='
CACHE_VERSION = '22'
MARKER = '/*whatsai-patch:root-redirect:v1*/'
REQUIRED = ('/*whatsai-patch:usage-limits:component*/',)

GROUPS = [
    ('logged-in login redirect',
     'return t&&n&&r?i.jsx(Cj,{to:"/"}):e}',
     'return t&&n&&r?i.jsx(Cj,{to:"/manager/",replace:!0}):e}',
     1),
    ('root route',
     'path:"/",element:i.jsx(Fse,{})',
     'path:"/",element:i.jsx(WaRootRedirect,{})',
     1),
    ('root redirect component',
     'function Fse(){',
     'function WaRootRedirect(){y.useEffect(()=>{let k="wa-root-redirect",s=null;try{s=sessionStorage.getItem(k)}catch{}'
     'const now=Date.now();if(s&&now-Number(s)<5e3){window.location.replace("/manager/");return}'
     'try{sessionStorage.setItem(k,String(now))}catch{}window.location.replace("/")},[]);return null}function Fse(){',
     1),
]


class PatchError(Exception):
    pass


def bump_cache(html):
    pos = html.find(SCRIPT_TAG)
    if pos < 0 or html.count(SCRIPT_TAG) != 1:
        raise PatchError('index.html: bundle script tag not found exactly once')
    end = pos + len(SCRIPT_TAG)
    while end < len(html) and html[end].isdigit():
        end += 1
    current = html[pos + len(SCRIPT_TAG):end]
    if not current.isdigit():
        raise PatchError(f'index.html: unexpected bundle version ?v={current}')
    if int(current) >= int(CACHE_VERSION):
        return html
    return html[:pos + len(SCRIPT_TAG)] + CACHE_VERSION + html[end:]


def main():
    check = '--check' in sys.argv[1:]
    with open(BUNDLE, encoding='utf-8') as f:
        bundle = f.read()
    with open(INDEX, encoding='utf-8') as f:
        html = f.read()

    applied = MARKER in bundle
    cache_ok = bump_cache(html) == html
    if check:
        ok = applied and cache_ok
        print('ok: all groups applied' if ok else 'missing: root-redirect' if not applied else 'missing: index.html cache version')
        return 0 if ok else 1

    for required in REQUIRED:
        if required not in bundle:
            raise PatchError(f'run the patch that adds {required} first')

    if not applied:
        for name, old, new, expected in GROUPS:
            found = bundle.count(old)
            if found != expected:
                raise PatchError(f'{name}: expected {expected} match(es), got {found}')
        for name, old, new, _ in GROUPS:
            bundle = bundle.replace(old, new)
            print(f'{name}: applied')
        bundle = MARKER + bundle
        with open(BUNDLE, 'w', encoding='utf-8') as f:
            f.write(bundle)
    else:
        print('root-redirect: already applied')

    new_html = bump_cache(html)
    if new_html != html:
        with open(INDEX, 'w', encoding='utf-8') as f:
            f.write(new_html)
    print(f'index.html: bundle ?v={CACHE_VERSION}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except PatchError as error:
        print(f'error: {error}', file=sys.stderr)
        sys.exit(2)
