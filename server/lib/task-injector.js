// Inject a synthetic email into an agent's IMAP inbox so the poller picks it up
// as a normal "task". Uses the agent's own imap-credentials.json + config.json
// (only IMAP-based agents are supported; Gmail OAuth agents can't APPEND from
// outside their OAuth scope cleanly).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SKILLS_ROOT } = require('./skill-fs');

function injectEmail({ agentId, fromEmail, fromName, subject, body }) {
  return new Promise((resolve, reject) => {
    const skillDir = path.join(SKILLS_ROOT, agentId);
    if (!fs.existsSync(path.join(skillDir, 'config.json')))
      return reject(new Error(`agent ${agentId}: no config.json`));
    if (!fs.existsSync(path.join(skillDir, 'imap-credentials.json')))
      return reject(new Error(`agent ${agentId}: no imap-credentials.json (only IMAP agents supported)`));

    // Pass values via env to avoid quoting/escaping issues with arbitrary user
    // input in the python source string.
    const script = `
import imaplib, json, os, sys, time
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid
from pathlib import Path

skill_dir = Path(os.environ["SKILL_DIR"])
cfg = json.loads((skill_dir / "config.json").read_text())
pwd = json.loads((skill_dir / "imap-credentials.json").read_text())["password"]

from_email = os.environ["FROM_EMAIL"]
from_name  = os.environ.get("FROM_NAME", "")
subject    = os.environ["SUBJECT"]
body       = os.environ["BODY"]

msg = MIMEText(body, "plain", "utf-8")
msg["From"] = f"{from_name} <{from_email}>" if from_name else from_email
msg["To"]   = cfg["botEmail"]
msg["Subject"] = subject
msg["Date"]    = formatdate(localtime=True)
msg["Message-ID"] = make_msgid(domain=cfg["botEmail"].split("@", 1)[1])

host = cfg.get("imapHost", "localhost")
port = int(cfg.get("imapPort", 993))
use_ssl = cfg.get("imapSsl", True)
cls = imaplib.IMAP4_SSL if use_ssl else imaplib.IMAP4
M = cls(host, port)
M.login(cfg["botEmail"], pwd)
typ, _ = M.append("INBOX", None, imaplib.Time2Internaldate(time.time()), msg.as_bytes())
M.logout()
print(json.dumps({"ok": typ == "OK", "message_id": msg["Message-ID"], "to": cfg["botEmail"]}))
`;
    const env = {
      ...process.env,
      SKILL_DIR:  skillDir,
      FROM_EMAIL: fromEmail,
      FROM_NAME:  fromName || '',
      SUBJECT:    subject || '(sin asunto)',
      BODY:       body || '',
    };
    const proc = spawn('python3', ['-c', script], { env });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`inject ${code}: ${err.trim() || out.trim()}`));
      try { resolve(JSON.parse(out.trim())); } catch (e) { reject(new Error(`bad inject output: ${out.slice(0, 200)}`)); }
    });
  });
}

module.exports = { injectEmail };
