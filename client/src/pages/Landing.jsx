import { Link } from 'react-router-dom';
import { Bot, Mail, Zap, Shield, ArrowRight, CheckCircle2, Inbox, Reply, Sparkles, Code2, Globe } from 'lucide-react';

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
          <a href="#pricing" className="text-sm text-slate-400 hover:text-slate-200 transition">Pricing</a>
          <Link to="/chat" className="btn-primary text-sm">
            Sign in <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-xs text-violet-300 mb-6">
          <Mail size={11} /> Your inbox is the interface
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-slate-100 leading-tight mb-4">
          Fix bugs by sending<br />
          <span className="text-violet">an email</span>
        </h1>
        <p className="text-slate-400 text-lg max-w-2xl mx-auto mb-8">
          ClonAgent gives every project an AI engineer reachable by email.
          Send a bug report, get back a deployed fix and a reply with the diff — no dashboards, no tickets, no waiting.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/chat" className="btn-primary px-6 py-2.5 text-base">
            Get started free <ArrowRight size={16} />
          </Link>
          <a href="#how-it-works" className="btn-ghost px-6 py-2.5 text-base border border-border-subtle">
            See how it works
          </a>
        </div>
      </section>

      {/* Email demo */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {/* Inbound email */}
          <div className="card border-border-subtle">
            <div className="flex items-center gap-2 mb-3 text-xs text-slate-500 uppercase tracking-wider">
              <Inbox size={12} /> You write
            </div>
            <div className="space-y-2 text-xs font-mono text-slate-400">
              <div><span className="text-slate-600">To: </span><span className="text-emerald-300">bugbot@myapp.com</span></div>
              <div><span className="text-slate-600">From: </span>maria@mycompany.com</div>
              <div><span className="text-slate-600">Subject: </span><span className="text-slate-200">Login button broken on mobile</span></div>
              <div className="pt-2 border-t border-border-subtle text-slate-300 leading-relaxed">
                Hey, the login button on mobile doesn't work since yesterday's deploy.
                Users are getting a 401 on /api/auth/login when the X-Mobile header is set.
              </div>
            </div>
          </div>

          {/* Reply */}
          <div className="card border-violet/30 bg-violet/5">
            <div className="flex items-center gap-2 mb-3 text-xs text-violet-400 uppercase tracking-wider">
              <Reply size={12} /> ClonAgent replies
            </div>
            <div className="space-y-2 text-xs font-mono text-slate-400">
              <div><span className="text-slate-600">To: </span>maria@mycompany.com</div>
              <div><span className="text-slate-600">Subject: </span><span className="text-slate-200">Re: Login button broken on mobile ✓ Fixed</span></div>
              <div className="pt-2 border-t border-border-subtle text-slate-300 leading-relaxed space-y-1.5">
                <p>Fixed and deployed. The middleware was stripping the session cookie when <span className="text-violet-300">X-Mobile: true</span> was present.</p>
                <p className="text-slate-500">— server/middleware/auth.js line 42<br/>+ added cookie passthrough for mobile header</p>
                <p className="text-emerald-400">✓ Tests pass · ✓ Deployed to prod</p>
              </div>
            </div>
          </div>
        </div>
        <p className="text-center text-xs text-slate-600 mt-4">Average time from email to deployed fix: ~3 minutes</p>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="max-w-6xl mx-auto px-6 py-16 border-t border-border-subtle">
        <h2 className="text-2xl font-semibold text-slate-100 mb-2">How it works</h2>
        <p className="text-slate-400 mb-10">Email in. Fix deployed. Reply sent. That's it.</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { n: '01', icon: Mail,         title: 'Email arrives',    body: 'An authorized sender emails your agent\'s inbox with a bug report or request.' },
            { n: '02', icon: Bot,          title: 'Claude reads it',  body: 'A full Claude Code session starts — reads your codebase, understands the problem.' },
            { n: '03', icon: Code2,        title: 'Fix deployed',     body: 'Claude edits files, runs tests, and deploys to your server via SSH or CI.' },
            { n: '04', icon: Reply,        title: 'Reply sent',       body: 'The sender gets an email with the fix summary, diff, and confirmation.' },
          ].map(s => (
            <div key={s.n} className="card">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl font-bold text-violet/25">{s.n}</span>
                <s.icon size={16} className="text-violet-400" />
              </div>
              <h3 className="font-semibold text-slate-100 mb-1">{s.title}</h3>
              <p className="text-sm text-slate-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Key power: email as interface */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-border-subtle">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-xs text-violet-300 mb-4">
              <Mail size={11} /> The key insight
            </div>
            <h2 className="text-2xl font-semibold text-slate-100 mb-4">
              Email is the only interface your team needs to learn
            </h2>
            <p className="text-slate-400 mb-4">
              No new tools. No new logins. No dashboards to check.
              Your team already knows how to write an email — that's all it takes to trigger a full AI-powered fix cycle.
            </p>
            <p className="text-slate-400 mb-6">
              Works from any device, any email client, anywhere in the world.
              If you can write an email, you can ship a fix.
            </p>
            <ul className="space-y-3">
              {[
                'Report a bug → get it fixed and deployed',
                'Request a feature → get a PR with the implementation',
                'Ask a question → get a code-level answer',
                'Any email client, any device, zero friction',
              ].map(s => (
                <li key={s} className="flex items-center gap-3 text-sm text-slate-300">
                  <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" /> {s}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            {[
              { from: 'cto@startup.com',     subject: 'Signup rate dropped after last deploy', tag: 'bug' },
              { from: 'pm@startup.com',       subject: 'Add CSV export to the reports page',   tag: 'feature' },
              { from: 'support@startup.com',  subject: 'Customer says dashboard loads slowly',  tag: 'perf' },
              { from: 'cto@startup.com',     subject: 'Re: Signup rate dropped ✓ Fixed',       tag: 'done', done: true },
            ].map((e, i) => (
              <div key={i} className={`card py-3 flex items-start justify-between gap-3 ${e.done ? 'border-emerald-500/30 bg-emerald-500/5' : ''}`}>
                <div className="min-w-0">
                  <div className="text-xs text-slate-500 mb-0.5">{e.from}</div>
                  <div className={`text-sm truncate ${e.done ? 'text-emerald-300' : 'text-slate-200'}`}>{e.subject}</div>
                </div>
                <span className={`pill flex-shrink-0 ${
                  e.done       ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : e.tag === 'bug'     ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                : e.tag === 'feature' ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
                :                       'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                }`}>
                  {e.tag}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-border-subtle">
        <h2 className="text-2xl font-semibold text-slate-100 mb-2">Everything included</h2>
        <p className="text-slate-400 mb-10">One agent per project. All the power of Claude Code, triggered by email.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: Shield,  title: 'Allowlist security',    body: 'Only emails from approved addresses trigger a run. Everyone else gets a polite rejection.' },
            { icon: Bot,     title: 'Full Claude Code session', body: 'Reads files, runs tests, edits code — everything a senior engineer would do.' },
            { icon: Code2,   title: 'Deploys automatically', body: 'SSH, CI webhook, or any custom deploy script. Ships to prod without anyone touching a keyboard.' },
            { icon: Reply,   title: 'Replies with the diff', body: 'The reporter gets an email back with what changed, what was tested, and confirmation it\'s live.' },
            { icon: Zap,     title: 'Live activity feed',    body: 'Watch every Claude tool call in real time from the AgentHub dashboard.' },
            { icon: Globe,   title: 'Any email provider',    body: 'Gmail OAuth, IMAP, or a self-hosted mailbox — each agent gets its own dedicated inbox.' },
          ].map(f => (
            <div key={f.title} className="card flex flex-col gap-3">
              <div className="w-8 h-8 rounded-lg bg-violet/10 border border-violet/30 flex items-center justify-center">
                <f.icon size={16} className="text-violet-300" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-100 mb-1">{f.title}</h3>
                <p className="text-sm text-slate-400">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-border-subtle" id="pricing">
        <h2 className="text-2xl font-semibold text-slate-100 mb-2">Simple pricing</h2>
        <p className="text-slate-400 mb-10">Start free. Upgrade when you need more agents or runs.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <PricingCard
            name="Free"
            price={0}
            features={['1 agent', '20 runs / month', 'Own Anthropic API key', 'Community support']}
            cta="Get started free"
            ctaTo="/chat"
          />
          <PricingCard
            name="Starter"
            price={29}
            highlight
            features={['5 agents', '200 runs / month', 'Platform API key included', 'Email support']}
            cta="Start Starter"
            ctaTo="/billing"
          />
          <PricingCard
            name="Pro"
            price={99}
            features={['20 agents', 'Unlimited runs', 'Platform API key included', 'Priority support']}
            cta="Start Pro"
            ctaTo="/billing"
          />
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-16 text-center">
          <h2 className="text-2xl font-semibold text-slate-100 mb-3">
            Your next bug fix is one email away
          </h2>
          <p className="text-slate-400 mb-6 max-w-lg mx-auto">
            Set up your first agent in minutes. No code changes needed in your project.
          </p>
          <Link to="/chat" className="btn-primary px-8 py-3 text-base">
            Get started free <ArrowRight size={16} />
          </Link>
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
