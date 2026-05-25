// Thin wrapper around the Stripe SDK.
// All Stripe calls go through here so the rest of the app stays clean.
let _stripe;

function getStripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) return null;
    _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

module.exports = { getStripe };
