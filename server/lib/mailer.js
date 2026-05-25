// Transactional email via the docker-mailserver (SMTP on localhost:587).
// Set SMTP_* env vars to override; works with any SMTP provider.
const nodemailer = require('nodemailer');

const FROM_NAME    = process.env.SMTP_FROM_NAME    || 'ClonAgent';
const FROM_ADDRESS = process.env.SMTP_FROM_ADDRESS || 'noreply@bot.utopiaia.com';

function createTransport() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === '1',
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      } : undefined,
    });
  }
  // SendGrid via env
  if (process.env.SENDGRID_API_KEY) {
    return nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY },
    });
  }
  // Fallback: log to console (dev mode)
  return null;
}

async function send({ to, subject, html, text }) {
  const transport = createTransport();
  if (!transport) {
    console.log(`[mailer] (no SMTP configured) To: ${to} | Subject: ${subject}`);
    return;
  }
  await transport.sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ''),
  });
}

async function sendWelcome({ to, name }) {
  const url = process.env.PUBLIC_URL || 'https://clonagent.utopiaia.com';
  await send({
    to,
    subject: `Welcome to ClonAgent, ${name} — your AI engineer is ready`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;color:#e2e8f0;background:#0f1117;padding:36px;border-radius:12px">
        <h1 style="color:#a78bfa;margin:0 0 4px;font-size:22px">Welcome, ${name} 👋</h1>
        <p style="color:#94a3b8;margin:0 0 24px;font-size:15px">Your ClonAgent is ready. Here's how to get your first agent running in 5 minutes.</p>

        <div style="background:#171b22;border-radius:10px;padding:20px;margin-bottom:20px">
          <p style="margin:0 0 12px;font-weight:600;color:#e2e8f0">What ClonAgent does</p>
          <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.6">
            You give it a project (a website, an app, any code). It watches an email inbox.
            When someone authorized emails a bug or request, ClonAgent reads it, fixes the code,
            deploys the fix, and replies with the result — automatically, while you sleep.
          </p>
        </div>

        <p style="font-weight:600;color:#e2e8f0;margin:0 0 12px">3 steps to get started:</p>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="vertical-align:top;padding:8px 12px 8px 0;color:#7c5cff;font-weight:700;white-space:nowrap">Step 1</td>
            <td style="padding:8px 0;color:#94a3b8;font-size:14px">Open the chat and describe your agent: what project it manages, who can email it, and how to deploy.</td>
          </tr>
          <tr>
            <td style="vertical-align:top;padding:8px 12px 8px 0;color:#7c5cff;font-weight:700;white-space:nowrap">Step 2</td>
            <td style="padding:8px 0;color:#94a3b8;font-size:14px">ClonAgent creates everything for you. Just drop in your Gmail credentials (takes 2 minutes).</td>
          </tr>
          <tr>
            <td style="vertical-align:top;padding:8px 12px 8px 0;color:#7c5cff;font-weight:700;white-space:nowrap">Step 3</td>
            <td style="padding:8px 0;color:#94a3b8;font-size:14px">Turn it on. From now on, manage it entirely by email — send <strong style="color:#e2e8f0">!help</strong> to your bot's inbox to see all commands.</td>
          </tr>
        </table>

        <div style="text-align:center;margin-top:28px">
          <a href="${url}/chat"
             style="display:inline-block;background:#7c5cff;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
            Create my first agent →
          </a>
        </div>

        <div style="margin-top:28px;padding-top:20px;border-top:1px solid #1f2330">
          <p style="color:#475569;font-size:12px;margin:0">Once your agent is running, you can manage it entirely from email:</p>
          <p style="color:#64748b;font-size:12px;font-family:monospace;margin:8px 0 0;line-height:1.8">
            !status &nbsp;·&nbsp; !add someone@company.com &nbsp;·&nbsp; !pause &nbsp;·&nbsp; !resume
          </p>
        </div>

        <p style="color:#334155;font-size:11px;margin-top:20px">
          Created by Kiko Cisneros for <a href="https://utopiaia.com" style="color:#475569">Utopia IA</a>
        </p>
      </div>`,
  });
}

async function sendUpgradeConfirmation({ to, name, plan }) {
  await send({
    to,
    subject: `You're on the ${plan} plan — ClonAgent`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;color:#e2e8f0;background:#0f1117;padding:32px;border-radius:12px">
        <h1 style="color:#34d399;margin:0 0 8px">You're on ${plan}!</h1>
        <p>Hi ${name}, your ClonAgent subscription is active. Enjoy your expanded limits.</p>
        <a href="${process.env.PUBLIC_URL || 'https://clonagent.utopiaia.com'}/billing"
           style="display:inline-block;background:#7c5cff;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;margin-top:12px">
          Manage billing →
        </a>
      </div>`,
  });
}

async function sendPasswordReset({ to, name, token }) {
  const link = `${process.env.PUBLIC_URL || 'https://clonagent.utopiaia.com'}/reset-password?token=${token}`;
  await send({
    to,
    subject: 'Reset your ClonAgent password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;color:#e2e8f0;background:#0f1117;padding:32px;border-radius:12px">
        <h1 style="color:#a78bfa;margin:0 0 8px">Reset your password</h1>
        <p>Hi ${name}, click below to set a new password. This link expires in 1 hour.</p>
        <a href="${link}"
           style="display:inline-block;background:#7c5cff;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;margin-top:12px">
          Reset password →
        </a>
        <p style="color:#64748b;font-size:12px;margin-top:24px">If you didn't request this, you can safely ignore this email.</p>
      </div>`,
  });
}

module.exports = { send, sendWelcome, sendUpgradeConfirmation, sendPasswordReset };
