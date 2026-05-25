import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function Tos() {
  return (
    <div className="min-h-full bg-bg text-slate-300">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link to="/" className="btn-ghost text-xs mb-8 inline-flex">
          <ArrowLeft size={12} /> Back
        </Link>
        <h1 className="text-2xl font-bold text-slate-100 mb-2">Terms of Service</h1>
        <p className="text-xs text-slate-500 mb-8">Effective date: May 2026</p>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">1. Acceptance</h2>
            <p>By accessing or using ClonAgent ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">2. Description of Service</h2>
            <p>ClonAgent is a platform for creating and managing email-triage agents powered by Claude Code. The Service allows authorized users to automate bug-fix workflows triggered by email.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">3. Account Responsibilities</h2>
            <p>You are responsible for maintaining the security of your account credentials. You must not share your account with others or use the Service for unauthorized access to third-party systems. You are solely responsible for any actions taken by agents you create.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">4. Acceptable Use</h2>
            <p>You agree not to use the Service to: (a) violate any laws or regulations; (b) deploy agents that target systems you do not own or have authorization to access; (c) send unsolicited email; (d) exceed plan limits through technical workarounds.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">5. Billing</h2>
            <p>Paid plans are billed monthly via Stripe. Subscriptions auto-renew unless canceled before the renewal date. Refunds are not provided for partial billing periods. We reserve the right to change pricing with 30 days' notice.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">6. API Keys and Third-Party Services</h2>
            <p>ClonAgent may use Anthropic's Claude API on your behalf. You are responsible for ensuring your API key usage complies with Anthropic's terms. We are not responsible for costs incurred through API usage by your agents.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">7. Disclaimer of Warranties</h2>
            <p>The Service is provided "as is" without warranties of any kind. We do not guarantee that agents will fix every bug or that all email-triggered actions will succeed. Use in production systems is at your own risk.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">8. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, ClonAgent shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Service, including but not limited to code changes made by autonomous agents.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">9. Termination</h2>
            <p>We may suspend or terminate your account at any time if you breach these Terms. You may cancel your subscription at any time through the billing portal.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">10. Changes</h2>
            <p>We may update these Terms at any time. Continued use of the Service after changes are posted constitutes acceptance of the new Terms.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-100 mb-2">11. Contact</h2>
            <p>For questions about these Terms, contact us at <a href="mailto:legal@utopiaia.com" className="text-violet-300 hover:text-violet-200">legal@utopiaia.com</a>.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
