#!/usr/bin/env python3
"""IMAP/SMTP mail client for ClonAgent IMAP-based skills.

Reads connection settings from config.json (same dir) and the password from
imap-credentials.json (also same dir, mode 600). Mirrors the gmail_client.py
subcommands so SKILL.md flow works the same.
"""
from __future__ import annotations

import argparse, email, imaplib, json, os, smtplib, sys
from email.header import decode_header
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid, parseaddr
from pathlib import Path

SKILL_DIR    = Path(__file__).parent
CONFIG_FILE  = SKILL_DIR / 'config.json'
CREDS_FILE   = SKILL_DIR / 'imap-credentials.json'

PROCESSED_FOLDERS = ['INBOX/en-progreso-bot', 'INBOX/procesado-bot', 'INBOX/pendiente-revision-humana']


def authorized_senders():
    """Devuelve [{email, role}, ...] (acepta strings legacy)."""
    cfg = load_cfg()
    raw = cfg.get('authorizedSenders') or []
    out = []
    for i, s in enumerate(raw):
        if isinstance(s, str):
            out.append({'email': s.lower(), 'role': 'owner' if i == 0 else 'reader'})
        elif isinstance(s, dict) and s.get('email'):
            role = s.get('role') if s.get('role') in ('owner', 'cocreator', 'reader') else 'reader'
            out.append({'email': s['email'].lower(), 'role': role})
    if not out:
        print("❌ config.json sin authorizedSenders", file=sys.stderr); sys.exit(1)
    return out


def authorized_emails():
    return [s['email'] for s in authorized_senders()]


def role_for(email: str):
    e = (email or '').lower()
    if '<' in e and '>' in e:
        e = e.split('<', 1)[1].split('>', 1)[0]
    for s in authorized_senders():
        if s['email'] == e:
            return s['role']
    return None


def _thread_id_for(msg):
    """Identifica el hilo de email de forma estable.

    Estrategia: el primer Message-ID en la cadena References (= el primer mensaje
    del hilo) si existe; si no, usa el Message-ID propio. Esto coincide entre
    todos los replies del mismo hilo.
    """
    refs = (msg.get('References') or msg.get('In-Reply-To') or '').strip()
    if refs:
        # References puede contener varios <id> separados por whitespace
        for token in refs.split():
            token = token.strip()
            if token.startswith('<') and token.endswith('>'):
                return token
    own = (msg.get('Message-ID') or '').strip()
    return own


def load_cfg() -> dict:
    if not CONFIG_FILE.exists():
        sys.exit(f"missing {CONFIG_FILE}")
    cfg = json.loads(CONFIG_FILE.read_text())
    if not CREDS_FILE.exists():
        sys.exit(f"missing {CREDS_FILE} — write {{\"password\": \"...\"}} (mode 600)")
    cfg['password'] = json.loads(CREDS_FILE.read_text())['password']
    return cfg


def connect_imap(cfg):
    cls = imaplib.IMAP4_SSL if cfg.get('imapSsl', True) else imaplib.IMAP4
    M = cls(cfg['imapHost'], cfg.get('imapPort', 993 if cfg.get('imapSsl', True) else 143))
    M.login(cfg['botEmail'], cfg['password'])
    return M


def _decode(b):
    if isinstance(b, bytes):
        try: return b.decode()
        except: return b.decode('latin-1', errors='replace')
    return b


def _hdr(msg, name):
    raw = msg.get(name, '')
    parts = decode_header(raw)
    return ''.join(_decode(p) if isinstance(p, bytes) else p for p, _ in parts)


def _ensure_folder(M, folder):
    M.create(folder)  # safe-noop if exists


def cmd_list_unread(args):
    M = connect_imap(load_cfg())
    M.select('INBOX')
    out = []
    for sender in authorized_senders():
        typ, data = M.search(None, 'UNSEEN', f'FROM "{sender["email"]}"')
        if typ != 'OK': continue
        for uid in data[0].split():
            typ, msg_data = M.fetch(uid, '(RFC822.HEADER)')
            if typ != 'OK': continue
            msg = email.message_from_bytes(msg_data[0][1])
            out.append({
                'message_id':    _hdr(msg, 'Message-ID'),
                'thread_id':     _thread_id_for(msg),
                'uid':           uid.decode(),
                'subject':       _hdr(msg, 'Subject'),
                'from':          _hdr(msg, 'From'),
                'sender_email':  sender['email'],
                'sender_role':   sender['role'],
                'date':          _hdr(msg, 'Date'),
            })
    M.logout()
    print(json.dumps(out, ensure_ascii=False, indent=2))


def _fetch_full(M, uid):
    typ, msg_data = M.fetch(uid.encode(), '(RFC822)')
    if typ != 'OK': return None
    return email.message_from_bytes(msg_data[0][1])


def _body(msg):
    if msg.is_multipart():
        for p in msg.walk():
            if p.get_content_type() == 'text/plain':
                return _decode(p.get_payload(decode=True))
        for p in msg.walk():
            if p.get_content_type() == 'text/html':
                return _decode(p.get_payload(decode=True))
    return _decode(msg.get_payload(decode=True))


def cmd_get_thread(args):
    cfg = load_cfg()
    M = connect_imap(cfg)
    M.select('INBOX')
    msg = _fetch_full(M, args.message_id)
    if not msg:
        sys.exit(f"message {args.message_id} not found")
    from_ = _hdr(msg, 'From')
    out = {
        'message_id':  _hdr(msg, 'Message-ID'),
        'subject':     _hdr(msg, 'Subject'),
        'from':        from_,
        'sender_role': role_for(from_),
        'to':          _hdr(msg, 'To'),
        'cc':          _hdr(msg, 'Cc'),
        'date':        _hdr(msg, 'Date'),
        'in_reply_to': _hdr(msg, 'In-Reply-To'),
        'references':  _hdr(msg, 'References'),
        'body':        _body(msg),
    }
    M.logout()
    print(json.dumps(out, ensure_ascii=False, indent=2))


def cmd_reply(args):
    cfg = load_cfg()
    M = connect_imap(cfg)
    M.select('INBOX')
    msg = _fetch_full(M, args.uid)
    if not msg:
        sys.exit(f"uid {args.uid} not found")

    from_ = parseaddr(_hdr(msg, 'From'))[1]
    subj  = _hdr(msg, 'Subject')
    msgid = _hdr(msg, 'Message-ID')
    refs  = _hdr(msg, 'References')

    to = args.to or from_
    cc = args.cc.split(',') if args.cc else [e for e in authorized_emails() if e != to]

    if args.body_file: body = Path(args.body_file).read_text('utf-8')
    elif args.body:    body = args.body
    else:              body = sys.stdin.read()

    subject = args.subject or subj
    if subject and not subject.lower().startswith('re:'): subject = f'Re: {subject}'

    reply = MIMEText(body, 'plain', 'utf-8')
    reply['From']    = cfg['botEmail']
    reply['To']      = to
    if cc: reply['Cc'] = ', '.join(cc)
    reply['Subject'] = subject
    reply['Date']    = formatdate(localtime=True)
    reply['Message-ID'] = make_msgid(domain=cfg['botEmail'].split('@', 1)[1])
    if msgid:
        reply['In-Reply-To'] = msgid
        reply['References']  = f'{refs} {msgid}'.strip() if refs else msgid

    smtp_cls = smtplib.SMTP_SSL if cfg.get('smtpSsl', False) else smtplib.SMTP
    s = smtp_cls(cfg['smtpHost'], cfg.get('smtpPort', 587))
    if not cfg.get('smtpSsl', False): s.starttls()
    s.login(cfg['botEmail'], cfg['password'])
    rcpts = [to] + cc
    s.sendmail(cfg['botEmail'], rcpts, reply.as_string())
    s.quit()
    M.logout()
    print(json.dumps({'sent': True, 'to': to, 'cc': cc, 'subject': subject}))


def cmd_mark_read(args):
    cfg = load_cfg()
    M = connect_imap(cfg)
    M.select('INBOX')
    M.store(args.uid.encode(), '+FLAGS', '\\Seen')
    M.logout()
    print(json.dumps({'uid': args.uid, 'marked_read': True}))


def cmd_move(args):
    cfg = load_cfg()
    M = connect_imap(cfg)
    M.select('INBOX')
    _ensure_folder(M, args.folder)
    M.copy(args.uid.encode(), args.folder)
    M.store(args.uid.encode(), '+FLAGS', '\\Deleted')
    M.expunge()
    M.logout()
    print(json.dumps({'uid': args.uid, 'moved_to': args.folder}))


def main():
    p = argparse.ArgumentParser(description='IMAP/SMTP client (ClonAgent)')
    sub = p.add_subparsers(dest='cmd', required=True)
    pl = sub.add_parser('list-unread'); pl.add_argument('--days', type=int, default=7)
    pg = sub.add_parser('get-thread'); pg.add_argument('message_id')
    pr = sub.add_parser('reply'); pr.add_argument('uid')
    pr.add_argument('--body'); pr.add_argument('--body-file'); pr.add_argument('--subject')
    pr.add_argument('--to'); pr.add_argument('--cc')
    pm = sub.add_parser('mark-read'); pm.add_argument('uid')
    pmv = sub.add_parser('move'); pmv.add_argument('uid'); pmv.add_argument('folder')
    args = p.parse_args()
    handlers = {
        'list-unread': cmd_list_unread,
        'get-thread':  cmd_get_thread,
        'reply':       cmd_reply,
        'mark-read':   cmd_mark_read,
        'move':        cmd_move,
    }
    handlers[args.cmd](args)


if __name__ == '__main__':
    main()
