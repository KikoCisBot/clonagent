import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function Privacy() {
  return (
    <div className="min-h-full bg-bg text-slate-300">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link to="/" className="btn-ghost text-xs mb-8 inline-flex">
          <ArrowLeft size={12} /> Back
        </Link>
        <h1 className="text-2xl font-bold text-slate-100 mb-2">Privacy Policy</h1>
        <p className="text-xs text-slate-500 mb-8">Effective date: May 2026</p>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">1. What we collect</h2>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li><strong className="text-slate-300">Account information</strong>: username, email address, hashed password.</li>
              <li><strong className="text-slate-300">Agent configuration</strong>: agent names, authorized sender lists, deployment targets you provide.</li>
              <li><strong className="text-slate-300">Run logs</strong>: subject lines, from addresses, run status, and Claude session cost metadata for agents you create.</li>
              <li><strong className="text-slate-300">Billing information</strong>: Stripe customer ID and subscription status (no card numbers — Stripe handles those).</li>
              <li><strong className="text-slate-300">Usage data</strong>: request logs, error logs, for debugging and abuse prevention.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">2. How we use it</h2>
            <p>We use your data to provide the Service, send transactional emails (welcome, billing confirmations, password resets), enforce plan limits, and debug issues. We do not sell your data to third parties.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">3. Email content</h2>
            <p>Emails processed by your agents are not stored permanently. Subject lines and sender addresses are logged for the run history view. Full email bodies are passed to Claude for processing and are not retained beyond the session.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">4. Third-party services</h2>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li><strong className="text-slate-300">Stripe</strong>: processes payments. Subject to <a href="https://stripe.com/privacy" className="text-violet-300">Stripe's Privacy Policy</a>.</li>
              <li><strong className="text-slate-300">Anthropic</strong>: Claude API processes email content and code on your behalf. Subject to <a href="https://www.anthropic.com/privacy" className="text-violet-300">Anthropic's Privacy Policy</a>.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">5. Data retention</h2>
            <p>Account data is retained while your account is active. You may delete your account at any time by contacting support, which will delete your agents, run history, and personal data within 30 days.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">6. Security</h2>
            <p>We store passwords hashed with bcrypt. API keys and credentials are stored encrypted at rest. Sensitive files (OAuth tokens, IMAP credentials) are mode 600 and never exposed via the API.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">7. Your rights (GDPR / CCPA)</h2>
            <p>You may request access to, correction of, or deletion of your personal data at any time by emailing <a href="mailto:privacy@utopiaia.com" className="text-violet-300 hover:text-violet-200">privacy@utopiaia.com</a>. We will respond within 30 days.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">8. Cookies</h2>
            <p>We use a single session cookie to keep you logged in. No tracking or analytics cookies are used.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">9. Contact</h2>
            <p>Privacy questions: <a href="mailto:privacy@utopiaia.com" className="text-violet-300 hover:text-violet-200">privacy@utopiaia.com</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
