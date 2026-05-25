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
  await send({
    to,
    subject: 'Welcome to ClonAgent',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;color:#e2e8f0;background:#0f1117;padding:32px;border-radius:12px">
        <h1 style="color:#a78bfa;margin:0 0 8px">Welcome, ${name}!</h1>
        <p>Your ClonAgent account is ready. Sign in and create your first email-triage agent in minutes.</p>
        <a href="${process.env.PUBLIC_URL || 'https://clonagent.utopiaia.com'}/chat"
           style="display:inline-block;background:#7c5cff;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;margin-top:12px">
          Open ClonAgent →
        </a>
        <p style="color:#64748b;font-size:12px;margin-top:24px">If you didn't create this account, you can safely ignore this email.</p>
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
