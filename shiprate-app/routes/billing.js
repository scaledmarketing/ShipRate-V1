/**
 * Shopify Billing API — recurring charges for paid plans
 */

const express = require('express');
const fetch = require('node-fetch');
const queries = require('../db/queries');
const { requireAuth } = require('./auth');

const router = express.Router();

const APP_URL = process.env.APP_URL;

const PLANS = {
  starter: { name: 'Starter', price: 39.00, credits: 10000, trial_days: 14 },
  growth: { name: 'Growth', price: 69.00, credits: 25000, trial_days: 14 },
  scale: { name: 'Scale', price: 119.00, credits: 75000, trial_days: 14 },
};

// ─── Start plan upgrade ───
router.post('/billing/subscribe', requireAuth, async function (req, res) {
  const planKey = req.body.plan;
  const plan = PLANS[planKey];
  const merchant = req.merchant;

  if (!plan) return res.status(400).json({ error: 'Invalid plan' });

  try {
    const chargeRes = await fetch('https://' + merchant.shop + '/admin/api/2024-01/recurring_application_charges.json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': merchant.access_token,
      },
      body: JSON.stringify({
        recurring_application_charge: {
          name: 'ShipRate ' + plan.name,
          price: plan.price,
          return_url: APP_URL + '/billing/confirm?plan=' + planKey,
          trial_days: plan.trial_days,
          test: process.env.NODE_ENV !== 'production', // Test charges in dev
        },
      }),
    });

    const chargeData = await chargeRes.json();
    const charge = chargeData.recurring_application_charge;

    if (charge && charge.confirmation_url) {
      return res.json({ redirect: charge.confirmation_url });
    } else {
      console.error('[Billing] Charge creation failed:', chargeData);
      return res.status(500).json({ error: 'Failed to create charge' });
    }
  } catch (err) {
    console.error('[Billing] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Confirm plan after Shopify redirect ───
router.get('/billing/confirm', requireAuth, async function (req, res) {
  const chargeId = req.query.charge_id;
  const planKey = req.query.plan;
  const plan = PLANS[planKey];
  const merchant = req.merchant;

  if (!chargeId || !plan) return res.redirect('/dashboard');

  try {
    // Verify the charge was accepted
    const verifyRes = await fetch('https://' + merchant.shop + '/admin/api/2024-01/recurring_application_charges/' + chargeId + '.json', {
      headers: { 'X-Shopify-Access-Token': merchant.access_token },
    });

    const verifyData = await verifyRes.json();
    const charge = verifyData.recurring_application_charge;

    if (charge && charge.status === 'accepted') {
      // Activate the charge
      await fetch('https://' + merchant.shop + '/admin/api/2024-01/recurring_application_charges/' + chargeId + '/activate.json', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': merchant.access_token,
        },
        body: JSON.stringify({ recurring_application_charge: { id: chargeId } }),
      });

      // Update merchant plan
      queries.updateMerchantPlan.run({
        id: merchant.id,
        plan: planKey,
        credits_limit: plan.credits,
        billing_charge_id: String(chargeId),
        billing_status: 'active',
      });

      console.log('[Billing] ✅ ' + merchant.shop + ' upgraded to ' + plan.name);
    }

    res.redirect('/dashboard?upgraded=' + planKey);
  } catch (err) {
    console.error('[Billing] Confirm error:', err.message);
    res.redirect('/dashboard?error=billing');
  }
});

// ─── Cancel plan ───
router.post('/billing/cancel', requireAuth, async function (req, res) {
  const merchant = req.merchant;

  if (merchant.billing_charge_id) {
    try {
      await fetch('https://' + merchant.shop + '/admin/api/2024-01/recurring_application_charges/' + merchant.billing_charge_id + '.json', {
        method: 'DELETE',
        headers: { 'X-Shopify-Access-Token': merchant.access_token },
      });
    } catch (err) {
      console.error('[Billing] Cancel error:', err.message);
    }
  }

  queries.updateMerchantPlan.run({
    id: merchant.id,
    plan: 'free',
    credits_limit: 500,
    billing_charge_id: null,
    billing_status: 'free',
  });

  res.redirect('/dashboard');
});

module.exports = router;
