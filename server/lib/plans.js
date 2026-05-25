// Plan definitions — single source of truth for limits and Stripe price IDs.
const PLANS = {
  free: {
    id:          'free',
    name:        'Free',
    price:       0,
    maxAgents:   1,
    maxRunsPerMonth: 20,
    stripePriceId: null,
  },
  starter: {
    id:          'starter',
    name:        'Starter',
    price:       29,
    maxAgents:   5,
    maxRunsPerMonth: 200,
    stripePriceId: process.env.STRIPE_PRICE_STARTER || '',
  },
  pro: {
    id:          'pro',
    name:        'Pro',
    price:       99,
    maxAgents:   20,
    maxRunsPerMonth: Infinity,
    stripePriceId: process.env.STRIPE_PRICE_PRO || '',
  },
};

function getPlan(planId) {
  return PLANS[planId] || PLANS.free;
}

function allPlans() {
  return Object.values(PLANS);
}

module.exports = { PLANS, getPlan, allPlans };
