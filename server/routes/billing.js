// Stripe billing: checkout, customer portal, webhook.
const express = require('express');
const { getStripe } = require('../lib/stripe-client');
const users = require('../lib/users');
const { getPlan, allPlans } = require('../lib/plans');
const { sendUpgradeConfirmation } = require('../lib/mailer');

const router = express.Router();

const PUBLIC_URL = () => process.env.PUBLIC_URL || 'https://clonagent.utopiaia.com';

// ── GET /api/billing/plans ──────────────────────────────────────────────────
router.get('/plans', (req, res) => {
  res.json(allPlans().map(p => ({
    id:              p.id,
    name:            p.name,
    price:           p.price,
    maxAgents:       p.maxAgents,
    maxRunsPerMonth: p.maxRunsPerMonth === Infinity ? null : p.maxRunsPerMonth,
    stripePriceId:   !!p.stripePriceId,   // just expose whether it's configured
  })));
});

// ── GET /api/billing/me ─────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'auth required' });
  const u = users.findUser(req.session.user.sub);
  if (!u) return res.status(404).json({ error: 'user not found' });
  const plan = getPlan(u.plan || 'free');
  res.json({
    plan:               plan.id,
    planName:           plan.name,
    maxAgents:          plan.maxAgents,
    maxRunsPerMonth:    plan.maxRunsPerMonth === Infinity ? null : plan.maxRunsPerMonth,
    stripeCustomerId:   u.stripeCustomerId   || null,
    subscriptionStatus: u.subscriptionStatus || (plan.id === 'free' ? 'free' : 'active'),
    planExpiresAt:      u.planExpiresAt      || null,
  });
});

// ── POST /api/billing/checkout ──────────────────────────────────────────────
router.post('/checkout', async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'auth required' });
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured — add STRIPE_SECRET_KEY' });

  const { planId } = req.body || {};
  const plan = getPlan(planId);
  if (!plan.stripePriceId) return res.status(400).json({ error: `No Stripe price configured for plan "${planId}"` });

  const u = users.findUser(req.session.user.sub);
  if (!u) return res.status(404).json({ error: 'user not found' });

  try {
    const session = await stripe.checkout.sessions.create({
      mode:        'subscription',
      line_items:  [{ price: plan.stripePriceId, quantity: 1 }],
      customer_email: u.email || undefined,
      metadata:    { username: u.username, planId: plan.id },
      success_url: `${PUBLIC_URL()}/billing?session_id={CHECKOUT_SESSION_ID}&success=1`,
      cancel_url:  `${PUBLIC_URL()}/billing?canceled=1`,
      subscription_data: { metadata: { username: u.username, planId: plan.id } },
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/billing/portal ────────────────────────────────────────────────
router.post('/portal', async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'auth required' });
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const u = users.findUser(req.session.user.sub);
  if (!u?.stripeCustomerId) return res.status(400).json({ error: 'no Stripe customer linked — subscribe first' });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer:   u.stripeCustomerId,
      return_url: `${PUBLIC_URL()}/billing`,
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/billing/webhook ───────────────────────────────────────────────
// The raw body handler is exported separately and mounted BEFORE express.json()
// in index.js. The route below is a no-op placeholder so the router is consistent.
router.post('/webhook', (req, res) => res.sendStatus(200));

async function handleStripeEvent(event) {
  const stripe = getStripe();

  if (event.type === 'checkout.session.completed') {
    const session  = event.data.object;
    const username = session.metadata?.username;
    const planId   = session.metadata?.planId;
    if (!username || !planId) return;

    const subId = session.subscription;
    const sub   = subId ? await stripe.subscriptions.retrieve(subId) : null;

    users.updateUserPlan(username, {
      plan:               planId,
      stripeCustomerId:   session.customer,
      stripeSubscriptionId: subId || '',
      subscriptionStatus: sub?.status || 'active',
      planExpiresAt:      sub?.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
    });

    const u = users.findUser(username);
    if (u?.email) {
      await sendUpgradeConfirmation({ to: u.email, name: u.name, plan: getPlan(planId).name }).catch(() => {});
    }
    console.log(`[billing] ${username} upgraded to ${planId}`);
  }

  if (event.type === 'customer.subscription.updated') {
    const sub      = event.data.object;
    const username = sub.metadata?.username;
    if (!username) return;
    const planId = getPlanIdByStripePrice(sub.items?.data?.[0]?.price?.id);
    users.updateUserPlan(username, {
      plan:               planId || 'free',
      subscriptionStatus: sub.status,
      planExpiresAt:      new Date(sub.current_period_end * 1000).toISOString(),
    });
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub      = event.data.object;
    const username = sub.metadata?.username;
    if (!username) return;
    users.updateUserPlan(username, {
      plan:               'free',
      subscriptionStatus: 'canceled',
      planExpiresAt:      null,
    });
    console.log(`[billing] ${username} subscription canceled → free`);
  }
}

function getPlanIdByStripePrice(priceId) {
  if (!priceId) return null;
  const { PLANS } = require('../lib/plans');
  return Object.values(PLANS).find(p => p.stripePriceId === priceId)?.id || null;
}

// Standalone webhook handler — mounted before express.json() in index.js
async function webhookHandler(req, res) {
  const stripe = getStripe();
  if (!stripe) return res.sendStatus(200);

  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = secret
      ? stripe.webhooks.constructEvent(req.body, sig, secret)
      : JSON.parse(req.body.toString());
  } catch (e) {
    return res.status(400).send(`Webhook error: ${e.message}`);
  }

  try { await handleStripeEvent(event); }
  catch (e) { console.error('[billing webhook]', e.message); }

  res.sendStatus(200);
}

module.exports = router;
module.exports.webhookHandler = webhookHandler;
