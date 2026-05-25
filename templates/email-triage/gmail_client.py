#!/usr/bin/env python3
"""Cliente Gmail genérico para skills de email-triage creadas por ClonAgent.

Lee la lista de remitentes autorizados desde `config.json` (mismo directorio),
así puede ser editada en caliente sin tocar este archivo.

Subcomandos:
  auth                                  Flujo OAuth (1ª vez)
  list-unread [--days N]                Threads no leídos de remitentes autorizados
  get-thread <thread_id>                Thread completo (JSON)
  reply <thread_id> --body-file FILE    Responder en el thread con CC a todos
  mark-read <thread_id>                 Quitar UNREAD
  add-label <thread_id> <label>         Añadir etiqueta (la crea si no existe)
  remove-label <thread_id> <label>      Quitar etiqueta
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from email.mime.text import MIMEText
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SKILL_DIR        = Path(__file__).parent
CREDENTIALS_FILE = SKILL_DIR / 'credentials.json'
TOKEN_FILE       = SKILL_DIR / 'token.json'
CONFIG_FILE      = SKILL_DIR / 'config.json'

SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.labels',
]


def load_config() -> dict:
    if not CONFIG_FILE.exists():
        print(f"❌ falta {CONFIG_FILE}", file=sys.stderr)
        sys.exit(1)
    return json.loads(CONFIG_FILE.read_text())


def authorized_senders():
    """Devuelve [{email, role}, ...] (acepta strings legacy)."""
    cfg = load_config()
    raw = cfg.get('authorizedSenders') or []
    out = []
    for i, s in enumerate(raw):
        if isinstance(s, str):
            out.append({'email': s.lower(), 'role': 'owner' if i == 0 else 'reader'})
        elif isinstance(s, dict) and s.get('email'):
            role = s.get('role') if s.get('role') in ('owner', 'cocreator', 'reader') else 'reader'
            out.append({'email': s['email'].lower(), 'role': role})
    if not out: sys.exit("config.json sin authorizedSenders")
    return out


def authorized_emails():
    return [s['email'] for s in authorized_senders()]


def role_for(email: str):
    e = (email or '').lower()
    if '<' in e and '>' in e:
        e = e.split('<', 1)[1].split('>', 1)[0]
    for s in authorized_senders():
        if s['email'] == e: return s['role']
    return None


def get_service():
    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if creds and creds.valid:
        return build('gmail', 'v1', credentials=creds, cache_discovery=False)
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            TOKEN_FILE.write_text(creds.to_json())
            return build('gmail', 'v1', credentials=creds, cache_discovery=False)
        except Exception as e:
            print(f"⚠️  No pude refrescar el token: {e}", file=sys.stderr)
            print("   Ejecuta: python3 gmail_client.py auth", file=sys.stderr)
            sys.exit(1)
    print("❌ No hay token válido. Ejecuta: python3 gmail_client.py auth", file=sys.stderr)
    sys.exit(1)


def cmd_auth(_):
    if not CREDENTIALS_FILE.exists():
        print(f"❌ Falta {CREDENTIALS_FILE}", file=sys.stderr)
        print("   Sube las credenciales OAuth de Google Cloud aquí.", file=sys.stderr)
        sys.exit(1)
    flow  = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
    creds = flow.run_local_server(port=8765, open_browser=True,
        success_message='OK. Vuelve al terminal.')
    TOKEN_FILE.write_text(creds.to_json())
    os.chmod(TOKEN_FILE, 0o600)
    profile = build('gmail', 'v1', credentials=creds).users().getProfile(userId='me').execute()
    print(json.dumps({'ok': True, 'authenticated_as': profile.get('emailAddress')}))


def _header(headers, name):
    for h in headers:
        if h['name'].lower() == name.lower(): return h['value']
    return ''


def cmd_list_unread(args):
    service = get_service()
    senders_query = ' OR '.join(f'from:{s["email"]}' for s in authorized_senders())
    skip = '-label:en-progreso-bot -label:procesado-bot -label:pendiente-revision-humana'
    query = f'in:inbox is:unread {skip} ({senders_query})'
    if args.days: query += f' newer_than:{args.days}d'
    result = service.users().threads().list(userId='me', q=query, maxResults=20).execute()
    out = []
    for t in result.get('threads', []):
        full = service.users().threads().get(userId='me', id=t['id'], format='metadata',
            metadataHeaders=['Subject','From','Date']).execute()
        msgs = full.get('messages', [])
        if not msgs: continue
        last = msgs[-1]
        headers = last.get('payload', {}).get('headers', [])
        from_ = _header(headers, 'From')
        out.append({
            'thread_id':       t['id'],
            'last_message_id': last['id'],
            'subject':         _header(headers,'Subject'),
            'from':            from_,
            'sender_role':     role_for(from_),
            'date':            _header(headers,'Date'),
            'snippet':         last.get('snippet',''),
            'message_count':   len(msgs),
        })
    print(json.dumps(out, ensure_ascii=False, indent=2))


def _decode(part):
    body = part.get('body', {}); data = body.get('data')
    return base64.urlsafe_b64decode(data).decode('utf-8','replace') if data else ''


def _extract_body(payload):
    if payload.get('mimeType','').startswith('text/plain'): return _decode(payload)
    parts = payload.get('parts', [])
    for p in parts:
        if p.get('mimeType','').startswith('text/plain'): return _decode(p)
    for p in parts:
        if p.get('mimeType','').startswith('text/html'):  return _decode(p)
    for p in parts:
        if p.get('parts'):
            sub = _extract_body(p)
            if sub: return sub
    return ''


def cmd_get_thread(args):
    service = get_service()
    thread = service.users().threads().get(userId='me', id=args.thread_id, format='full').execute()
    out = {'thread_id': thread['id'], 'messages': []}
    for msg in thread.get('messages', []):
        headers = msg.get('payload', {}).get('headers', [])
        out['messages'].append({
            'message_id':         msg['id'],
            'subject':            _header(headers,'Subject'),
            'from':               _header(headers,'From'),
            'to':                 _header(headers,'To'),
            'cc':                 _header(headers,'Cc'),
            'date':               _header(headers,'Date'),
            'message_id_header':  _header(headers,'Message-ID'),
            'in_reply_to':        _header(headers,'In-Reply-To'),
            'references':         _header(headers,'References'),
            'body':               _extract_body(msg.get('payload', {})),
            'snippet':            msg.get('snippet',''),
            'labels':             msg.get('labelIds', []),
        })
    print(json.dumps(out, ensure_ascii=False, indent=2))


def _email(field):
    if not field: return ''
    if '<' in field and '>' in field:
        return field.split('<',1)[1].split('>',1)[0].strip().lower()
    return field.strip().lower()


def cmd_reply(args):
    service = get_service()
    thread = service.users().threads().get(userId='me', id=args.thread_id, format='metadata',
        metadataHeaders=['Subject','From','Message-ID','References']).execute()
    msgs = thread.get('messages', [])
    if not msgs:
        print("❌ Thread vacío", file=sys.stderr); sys.exit(1)
    last = msgs[-1]; headers = last.get('payload',{}).get('headers',[])
    from_  = _email(_header(headers,'From'))
    subj   = _header(headers,'Subject')
    msgid  = _header(headers,'Message-ID')
    refs   = _header(headers,'References')

    to     = args.to or from_
    cc     = args.cc.split(',') if args.cc else [e for e in authorized_emails() if e != to]

    if args.body_file:   body = Path(args.body_file).read_text('utf-8')
    elif args.body:      body = args.body
    else:                body = sys.stdin.read()
    subject = args.subject or subj
    if subject and not subject.lower().startswith('re:'): subject = f'Re: {subject}'

    msg = MIMEText(body, 'plain', 'utf-8')
    msg['To'] = to
    if cc: msg['Cc'] = ', '.join(cc)
    msg['Subject'] = subject
    if msgid:
        msg['In-Reply-To'] = msgid
        msg['References']  = f'{refs} {msgid}' if refs else msgid

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode('utf-8')
    sent = service.users().messages().send(userId='me',
        body={'raw': raw, 'threadId': args.thread_id}).execute()
    print(json.dumps({'sent':True,'message_id':sent.get('id'),'thread_id':sent.get('threadId'),
                      'to':to,'cc':cc,'subject':subject}, ensure_ascii=False, indent=2))


def cmd_mark_read(args):
    get_service().users().threads().modify(userId='me', id=args.thread_id,
        body={'removeLabelIds': ['UNREAD']}).execute()
    print(json.dumps({'thread_id': args.thread_id, 'marked_read': True}))


def _label_id(service, name):
    for l in service.users().labels().list(userId='me').execute().get('labels', []):
        if l['name'].lower() == name.lower(): return l['id']
    created = service.users().labels().create(userId='me', body={
        'name': name, 'labelListVisibility': 'labelShow', 'messageListVisibility': 'show',
    }).execute()
    return created['id']


def cmd_add_label(args):
    service = get_service()
    lid = _label_id(service, args.label)
    service.users().threads().modify(userId='me', id=args.thread_id,
        body={'addLabelIds': [lid]}).execute()
    print(json.dumps({'thread_id': args.thread_id, 'label_added': args.label}))


def cmd_remove_label(args):
    service = get_service()
    lid = None
    for l in service.users().labels().list(userId='me').execute().get('labels', []):
        if l['name'].lower() == args.label.lower(): lid = l['id']; break
    if not lid:
        print(json.dumps({'thread_id': args.thread_id, 'label_removed': args.label, 'noop': True})); return
    service.users().threads().modify(userId='me', id=args.thread_id,
        body={'removeLabelIds': [lid]}).execute()
    print(json.dumps({'thread_id': args.thread_id, 'label_removed': args.label}))


def main():
    p = argparse.ArgumentParser(description='Gmail client (ClonAgent template)')
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('auth')
    pl = sub.add_parser('list-unread'); pl.add_argument('--days', type=int, default=7)
    pg = sub.add_parser('get-thread'); pg.add_argument('thread_id')
    pr = sub.add_parser('reply'); pr.add_argument('thread_id')
    pr.add_argument('--body'); pr.add_argument('--body-file'); pr.add_argument('--subject')
    pr.add_argument('--to'); pr.add_argument('--cc')
    pm = sub.add_parser('mark-read'); pm.add_argument('thread_id')
    pa = sub.add_parser('add-label'); pa.add_argument('thread_id'); pa.add_argument('label')
    px = sub.add_parser('remove-label'); px.add_argument('thread_id'); px.add_argument('label')
    args = p.parse_args()
    handlers = {'auth':cmd_auth,'list-unread':cmd_list_unread,'get-thread':cmd_get_thread,
                'reply':cmd_reply,'mark-read':cmd_mark_read,
                'add-label':cmd_add_label,'remove-label':cmd_remove_label}
    try: handlers[args.cmd](args)
    except HttpError as e:
        print(f"❌ Error API Gmail: {e}", file=sys.stderr); sys.exit(2)


if __name__ == '__main__':
    main()
