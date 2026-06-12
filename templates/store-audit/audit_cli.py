#!/usr/bin/env python3
"""audit_cli.py — Audit + feedback tooling for the store-audit ClonAgent skill.

Dependency-free (stdlib only). Reads publicUrl from config.json (same dir).

  python3 audit_cli.py audit <url>
  python3 audit_cli.py feedback add --kind <k> --email <e> [--url U --score N --note "..."]
  python3 audit_cli.py feedback digest [--days N]

The skill uses `audit` to run a live store audit via the public API, and the
`feedback` subcommands to log outcomes and summarize them so it can evolve
learnings.md. Feedback is only ever about inbound contacts who opted in.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import urllib.error
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path

SKILL_DIR    = Path(__file__).parent
CONFIG_FILE  = SKILL_DIR / 'config.json'
FEEDBACK_FILE = SKILL_DIR / 'feedback.jsonl'

VALID_KINDS = ['sent', 'reply', 'interested', 'objection', 'converted',
               'unsubscribe', 'complaint', 'owner-note', 'proposal', 'proposal-won']


def public_url() -> str:
    try:
        cfg = json.loads(CONFIG_FILE.read_text())
        return (cfg.get('publicUrl') or 'https://clonagent.utopiaia.com').rstrip('/')
    except Exception:
        return 'https://clonagent.utopiaia.com'


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── audit ───────────────────────────────────────────────────────────────────────
def cmd_audit(url: str) -> int:
    endpoint = public_url() + '/api/audit-store'
    body = json.dumps({'url': url}).encode()
    req = urllib.request.Request(endpoint, data=body,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode())
        except Exception:
            err = {'error': f'HTTP {e.code}'}
        print(json.dumps({'ok': False, **err}, ensure_ascii=False))
        return 1
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False))
        return 1
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


# ── feedback ─────────────────────────────────────────────────────────────────────
def cmd_feedback_add(args) -> int:
    if args.kind not in VALID_KINDS:
        print(f'invalid --kind (must be one of: {", ".join(VALID_KINDS)})', file=sys.stderr)
        return 2
    entry = {
        'at': now_iso(),
        'kind': args.kind,
        'email': (args.email or '').lower() or None,
        'url': args.url or None,
        'score': args.score,
        'note': args.note or None,
    }
    with FEEDBACK_FILE.open('a', encoding='utf-8') as f:
        f.write(json.dumps(entry, ensure_ascii=False) + '\n')
    print(json.dumps({'ok': True, 'logged': entry}, ensure_ascii=False))
    return 0


def load_feedback(days: int | None):
    if not FEEDBACK_FILE.exists():
        return []
    cutoff = None
    if days:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    out = []
    for line in FEEDBACK_FILE.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except Exception:
            continue
        if cutoff:
            try:
                if datetime.fromisoformat(e['at']) < cutoff:
                    continue
            except Exception:
                pass
        out.append(e)
    return out


def cmd_feedback_digest(days: int | None) -> int:
    rows = load_feedback(days)
    if not rows:
        print('# Feedback digest\n\n(no hay feedback registrado todavía)')
        return 0
    kinds = Counter(r.get('kind') for r in rows)
    sent = kinds.get('sent', 0)
    converted = kinds.get('converted', 0)
    conv_rate = f'{(converted / sent * 100):.0f}%' if sent else 'n/a'
    scores = [r['score'] for r in rows if isinstance(r.get('score'), (int, float))]
    avg_score = f'{sum(scores) / len(scores):.0f}/100' if scores else 'n/a'
    objections = [r.get('note') for r in rows if r.get('kind') == 'objection' and r.get('note')]
    converted_notes = [r.get('note') for r in rows if r.get('kind') == 'converted' and r.get('note')]
    owner_notes = [r.get('note') for r in rows if r.get('kind') == 'owner-note' and r.get('note')]

    span = f'últimos {days} días' if days else 'histórico completo'
    lines = [
        f'# Feedback digest ({span}) — {len(rows)} interacciones',
        '',
        '## Métricas',
        f'- Informes enviados (sent): {sent}',
        f'- Conversiones (converted): {converted}  →  tasa de conversión: {conv_rate}',
        f'- Interesados / objeciones / bajas / quejas: '
        f'{kinds.get("interested",0)} / {kinds.get("objection",0)} / '
        f'{kinds.get("unsubscribe",0)} / {kinds.get("complaint",0)}',
        f'- Score medio de tiendas auditadas: {avg_score}',
        '',
        '## Qué dijeron los que CONVIRTIERON (replica esto)',
        *([f'- {n}' for n in converted_notes] or ['- (sin datos)']),
        '',
        '## Objeciones recurrentes (prepara mejor respuesta)',
        *([f'- {n}' for n in objections] or ['- (sin datos)']),
        '',
        '## Notas del owner',
        *([f'- {n}' for n in owner_notes] or ['- (sin datos)']),
        '',
        '→ Usa esto para actualizar learnings.md y añadir una línea al Changelog.',
    ]
    print('\n'.join(lines))
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description='Store-audit skill CLI')
    sub = p.add_subparsers(dest='cmd', required=True)

    pa = sub.add_parser('audit', help='audit a store URL via the public API')
    pa.add_argument('url')

    pf = sub.add_parser('feedback', help='log / summarize feedback')
    fsub = pf.add_subparsers(dest='fcmd', required=True)
    fa = fsub.add_parser('add')
    fa.add_argument('--kind', required=True)
    fa.add_argument('--email')
    fa.add_argument('--url')
    fa.add_argument('--score', type=int)
    fa.add_argument('--note')
    fd = fsub.add_parser('digest')
    fd.add_argument('--days', type=int, default=None)

    args = p.parse_args()
    if args.cmd == 'audit':
        return cmd_audit(args.url)
    if args.cmd == 'feedback':
        if args.fcmd == 'add':
            return cmd_feedback_add(args)
        if args.fcmd == 'digest':
            return cmd_feedback_digest(args.days)
    p.print_help()
    return 2


if __name__ == '__main__':
    sys.exit(main())
