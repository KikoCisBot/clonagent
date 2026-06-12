import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Mail, ArrowRight, CheckCircle2, Sparkles, Reply, Globe, Code2, ShoppingCart, Megaphone, GraduationCap, MailOpen, Gauge } from 'lucide-react';
import StoreAudit from '../components/StoreAudit.jsx';

// ── Pricing card ─────────────────────────────────────────────────────────────
function PricingCard({ name, price, features, cta, ctaTo, highlight }) {
  return (
    <div className={`card flex flex-col gap-4 ${highlight ? 'border-violet/50 bg-violet/5 relative' : ''}`}>
      {highlight && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full bg-violet text-white text-[10px] font-semibold px-3 py-1">
          <Sparkles size={10} /> Most popular
        </div>
      )}
      <div>
        <div className="text-sm font-semibold text-slate-300 mb-1">{name}</div>
        <div className="flex items-end gap-1">
          <span className="text-3xl font-bold text-slate-100">${price}</span>
          {price > 0 && <span className="text-slate-500 text-sm mb-1">/month</span>}
        </div>
      </div>
      <ul className="space-y-2 flex-1">
        {features.map(f => (
          <li key={f} className="flex items-center gap-2 text-sm text-slate-300">
            <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" /> {f}
          </li>
        ))}
      </ul>
      <Link to={ctaTo} className={`btn-primary justify-center py-2 ${!highlight ? 'bg-surface-2 text-slate-200 hover:bg-surface-2/80' : ''}`}>
        {cta} <ArrowRight size={14} />
      </Link>
    </div>
  );
}

// ── Story card — each use case ────────────────────────────────────────────────
function StoryCard({ icon: Icon, color, persona, role, emails }) {
  return (
    <div className="card flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={18} />
        </div>
        <div>
          <div className="font-semibold text-slate-100 text-sm">{persona}</div>
          <div className="text-[11px] text-slate-500">{role}</div>
        </div>
      </div>
      <div className="space-y-2">
        {emails.map((e, i) => (
          <div key={i} className={`rounded-lg p-3 text-xs font-mono ${e.out ? 'bg-violet/10 border border-violet/20' : 'bg-surface-2 border border-border-subtle'}`}>
            <div className="text-[10px] uppercase tracking-wider mb-1 ${e.out ? 'text-violet-400' : 'text-slate-600'}">
              {e.out ? '← reply' : '→ sends'}
            </div>
            <div className={`font-semibold mb-0.5 ${e.out ? 'text-violet-200' : 'text-slate-200'}`}>{e.subject}</div>
            <div className={e.out ? 'text-violet-300/80' : 'text-slate-400'}>{e.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Email capture form ────────────────────────────────────────────────────────
function EmailCapture() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle'); // idle | loading | sent | error

  async function submit(e) {
    e.preventDefault();
    if (!email.includes('@')) return;
    setState('loading');
    try {
      const r = await fetch('/api/auth/magic/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!r.ok) throw new Error();
      setState('sent');
    } catch {
      setState('error');
    }
  }

  if (state === 'sent') return (
    <div className="flex flex-col items-center gap-2">
      <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
        <MailOpen size={20} className="text-emerald-400" />
      </div>
      <p className="text-slate-200 font-medium">Check your inbox</p>
      <p className="text-sm text-slate-400">We sent a sign-in link to <span className="text-slate-200">{email}</span></p>
    </div>
  );

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2 max-w-md mx-auto">
      <input
        type="email" required
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="your@email.com"
        className="input flex-1 text-base py-3"
      />
      <button type="submit" disabled={state === 'loading'} className="btn-primary px-6 py-3 text-base whitespace-nowrap">
        {state === 'loading' ? '…' : <>Get started free <ArrowRight size={16} /></>}
      </button>
      {state === 'error' && <p className="text-xs text-rose-400 mt-1">Something went wrong. <Link to="/chat" className="underline">Try signing in</Link></p>}
    </form>
  );
}

// ── Main landing ──────────────────────────────────────────────────────────────
const STORIES = [
  {
    icon: ShoppingCart,
    color: 'bg-emerald-500/15 text-emerald-300',
    persona: 'Laura',
    role: 'Selling handmade jewellery online',
    emails: [
      { subject: 'Add a "sold out" badge to my shop', body: 'When a product has 0 stock, show a red "Sold out" badge on the card.' },
      { out: true, subject: 'Re: Add a "sold out" badge ✓ Done', body: 'Badge added and deployed. Products with stock = 0 now show a red badge. Tested on Chrome and mobile.' },
    ],
  },
  {
    icon: Megaphone,
    color: 'bg-blue-500/15 text-blue-300',
    persona: 'Carlos',
    role: 'Running a digital marketing agency',
    emails: [
      { subject: 'Create a landing page for our new client', body: 'Need a landing for "Gym360" — fitness studio in Madrid. URL: gym360.utopiaia.com. Dark theme, modern, with a booking CTA.' },
      { out: true, subject: 'Re: Landing page for Gym360 ✓ Live', body: 'Landing published at gym360.utopiaia.com — dark theme, hero section, class schedule, and booking button. SSL active.' },
    ],
  },
  {
    icon: MailOpen,
    color: 'bg-amber-500/15 text-amber-300',
    persona: 'Sofía',
    role: 'Customer support at an e-commerce',
    emails: [
      { subject: 'Auto-reply to refund requests', body: 'When a customer emails about a refund, reply acknowledging receipt and saying we\'ll resolve in 24h. Log it in our DB.' },
      { out: true, subject: 'Re: Auto-reply to refund requests ✓ Active', body: 'Agent configured. Refund emails now get an instant ACK reply and are logged in the refunds table with timestamp and email.' },
    ],
  },
  {
    icon: GraduationCap,
    color: 'bg-rose-500/15 text-rose-300',
    persona: 'Marcos',
    role: 'Online teacher with 3,000 students',
    emails: [
      { subject: 'Build me a quiz for Module 4', body: '10 multiple-choice questions about JavaScript closures. Save results to the DB and show students their score.' },
      { out: true, subject: 'Re: Quiz for Module 4 ✓ Ready', body: 'Quiz live at learn.utopiaia.com/quiz/module4. 10 questions, results saved to quiz_results table, score shown on submit.' },
    ],
  },
  {
    icon: Code2,
    color: 'bg-violet/30 text-violet-300',
    persona: 'Andrés',
    role: 'Indie developer, solo founder',
    emails: [
      { subject: 'Users getting 500 errors on checkout', body: 'Getting reports since this morning. Stripe webhook might be broken after yesterday\'s deploy.' },
      { out: true, subject: 'Re: 500 errors on checkout ✓ Fixed', body: 'Found it: the webhook secret was missing from env after the deploy. Added it, restarted, tested 3 purchases — all working.' },
    ],
  },
  {
    icon: Globe,
    color: 'bg-cyan-500/15 text-cyan-300',
    persona: 'Elena',
    role: 'Small business owner, no tech team',
    emails: [
      { subject: 'I need a contact form on my website', body: 'Just a simple form: name, email, message. Send submissions to info@mybusiness.com.' },
      { out: true, subject: 'Re: Contact form ✓ Live', body: 'Form added to your website. Submissions go to info@mybusiness.com instantly. Spam protection included.' },
    ],
  },
];

export default function Landing() {
  return (
    <div className="min-h-full bg-bg text-slate-200">

      {/* Nav */}
      <header className="border-b border-border-subtle px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <Bot size={20} className="text-violet" />
          <span className="font-semibold text-slate-100 text-lg">ClonAgent</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="#audit" className="text-sm text-violet-300 hover:text-violet-200 transition inline-flex items-center gap-1"><Gauge size={13} /> Audita tu tienda</a>
          <a href="#stories" className="text-sm text-slate-400 hover:text-slate-200 transition hidden sm:block">Examples</a>
          <a href="#pricing" className="text-sm text-slate-400 hover:text-slate-200 transition hidden sm:block">Pricing</a>
          <Link to="/chat" className="text-sm text-slate-400 hover:text-slate-200 transition">Sign in</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-10 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-xs text-violet-300 mb-6">
          <Mail size={11} /> Your inbox is the only interface you need
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-slate-100 leading-tight mb-4">
          Tell it what you need.<br />
          <span className="text-violet">Get it done. By email.</span>
        </h1>
        <p className="text-slate-400 text-lg max-w-2xl mx-auto mb-10">
          ClonAgent gives you a personal AI that builds websites, fixes bugs, sets up automations,
          creates databases and replies to customers — all triggered by a simple email.
          No code. No dashboards. No complexity.
        </p>
        <EmailCapture />
        <p className="text-xs text-slate-600 mt-4">Free to start · No credit card required · Sign in with your email</p>
      </section>

      {/* Email demo */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card border-border-subtle">
            <div className="flex items-center gap-2 mb-3 text-xs text-slate-500 uppercase tracking-wider">
              <Mail size={12} /> You send
            </div>
            <div className="space-y-2 text-xs font-mono text-slate-400">
              <div><span className="text-slate-600">To: </span><span className="text-emerald-300">myagent@bot.utopiaia.com</span></div>
              <div><span className="text-slate-600">Subject: </span><span className="text-slate-200">Add a newsletter signup to my homepage</span></div>
              <div className="pt-2 border-t border-border-subtle text-slate-300 leading-relaxed">
                Put a simple signup form at the bottom of the homepage.
                Save emails to the subscribers table and send a welcome email.
              </div>
            </div>
          </div>
          <div className="card border-violet/30 bg-violet/5">
            <div className="flex items-center gap-2 mb-3 text-xs text-violet-400 uppercase tracking-wider">
              <Reply size={12} /> Agent replies
            </div>
            <div className="space-y-2 text-xs font-mono text-slate-400">
              <div><span className="text-slate-600">Subject: </span><span className="text-slate-200">Re: Newsletter signup ✓ Done</span></div>
              <div className="pt-2 border-t border-border-subtle text-slate-300 leading-relaxed space-y-1.5">
                <p>Added a signup form to the homepage footer.</p>
                <p className="text-slate-500">+ pages/index.html (form)<br/>+ api/subscribe.js (saves to DB)<br/>+ welcome email template</p>
                <p className="text-emerald-400">✓ Deployed · ✓ Tested with 2 signups</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Inbound store audit — free lead magnet for ecommerce */}
      <StoreAudit />

      {/* Storytelling — real use cases */}
      <section id="stories" className="max-w-6xl mx-auto px-6 py-16 border-t border-border-subtle">
        <h2 className="text-2xl font-semibold text-slate-100 mb-2">What people use it for</h2>
        <p className="text-slate-400 mb-10">
          One email. Your agent reads it, builds it, deploys it, and replies.
          No technical knowledge required — just describe what you need.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {STORIES.map(s => <StoryCard key={s.persona} {...s} />)}
        </div>
      </section>

      {/* Email as interface — key section */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-border-subtle">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-xs text-violet-300 mb-4">
              <Mail size={11} /> Email-first, always
            </div>
            <h2 className="text-2xl font-semibold text-slate-100 mb-4">
              Manage everything from your inbox — no dashboard needed
            </h2>
            <p className="text-slate-400 mb-6">
              Once your agent is running, your email is the control panel.
              Send commands to your agent's address and it responds instantly.
            </p>
            <div className="card font-mono text-xs space-y-2">
              {[
                ['!status',                    'Agent status and recent runs'],
                ['!add team@mycompany.com',     'Give someone access'],
                ['!remove old@mycompany.com',  'Revoke access'],
                ['!pause',                     'Pause the agent'],
                ['!resume',                    'Resume it'],
                ['!help',                      'See all commands'],
              ].map(([cmd, desc]) => (
                <div key={cmd} className="flex items-center gap-3">
                  <span className="text-violet-300 w-48 flex-shrink-0">{cmd}</span>
                  <span className="text-slate-500">{desc}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <div className="card py-3">
              <div className="text-xs text-slate-500 mb-1">You email your agent:</div>
              <div className="font-mono text-sm text-slate-200">!add maria@mycompany.com</div>
            </div>
            <div className="card py-3 border-emerald-500/30 bg-emerald-500/5">
              <div className="text-xs text-emerald-400 mb-1">Agent replies:</div>
              <div className="font-mono text-sm text-emerald-200">✅ Added maria@mycompany.com as an authorized sender.</div>
            </div>
            <div className="card py-3 mt-4">
              <div className="text-xs text-slate-500 mb-1">Maria emails the agent:</div>
              <div className="font-mono text-sm text-slate-200">The prices on the products page are wrong, they show without VAT</div>
            </div>
            <div className="card py-3 border-violet/30 bg-violet/5">
              <div className="text-xs text-violet-400 mb-1">Agent fixes it and replies to Maria:</div>
              <div className="font-mono text-sm text-violet-200">✓ Fixed. All prices now include 21% VAT. Deployed.</div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-border-subtle">
        <h2 className="text-2xl font-semibold text-slate-100 mb-2">Set up in 5 minutes</h2>
        <p className="text-slate-400 mb-10">Describe what you want in the chat. ClonAgent creates the agent for you.</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { n: '01', title: 'Enter your email',   body: 'No passwords. We send you a link — click it and you\'re in.' },
            { n: '02', title: 'Describe your agent', body: 'Tell the chat what project it manages and who can email it.' },
            { n: '03', title: 'Connect your inbox',  body: 'Link a Gmail account. Takes 2 minutes with our guided setup.' },
            { n: '04', title: 'Done — email away',   body: 'Your agent watches the inbox and acts on every message.' },
          ].map(s => (
            <div key={s.n} className="card">
              <div className="text-2xl font-bold text-violet/25 mb-2">{s.n}</div>
              <h3 className="font-semibold text-slate-100 mb-1">{s.title}</h3>
              <p className="text-sm text-slate-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-16 border-t border-border-subtle">
        <h2 className="text-2xl font-semibold text-slate-100 mb-2">Simple pricing</h2>
        <p className="text-slate-400 mb-10">Start free. Upgrade when you need more agents.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <PricingCard name="Free" price={0}
            features={['1 agent', '20 requests / month', 'Own Anthropic API key', 'Community support']}
            cta="Get started free" ctaTo="/chat" />
          <PricingCard name="Starter" price={29} highlight
            features={['5 agents', '200 requests / month', 'Platform API key included', 'Email support']}
            cta="Start Starter" ctaTo="/billing" />
          <PricingCard name="Pro" price={99}
            features={['20 agents', 'Unlimited requests', 'Platform API key included', 'Priority support']}
            cta="Start Pro" ctaTo="/billing" />
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-16 text-center">
          <h2 className="text-2xl font-semibold text-slate-100 mb-3">
            Your most powerful tool is your inbox
          </h2>
          <p className="text-slate-400 mb-8 max-w-lg mx-auto">
            Enter your email and be up and running in 5 minutes. No technical setup. No credit card.
          </p>
          <EmailCapture />
        </div>
      </section>

      <footer className="border-t border-border-subtle px-6 py-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-600">
          <span>ClonAgent — created by Kiko Cisneros for <a href="https://utopiaia.com" className="text-slate-500 hover:text-slate-400">Utopia IA</a></span>
          <div className="flex gap-4">
            <Link to="/tos" className="hover:text-slate-400">Terms of Service</Link>
            <Link to="/privacy" className="hover:text-slate-400">Privacy Policy</Link>
            <Link to="/chat" className="hover:text-slate-400">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
