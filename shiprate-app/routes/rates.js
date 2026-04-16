/**
 * Shopify Carrier Service callback — receives rate requests from all stores
 */

const express = require('express');
const queries = require('../db/queries');
const carriers = require('../carriers');

const router = express.Router();

// ─── Plans & credit limits ───
const PLANS = {
  free: { credits: 500, name: 'Free' },
  starter: { credits: 10000, name: 'Starter' },
  growth: { credits: 25000, name: 'Growth' },
  scale: { credits: 75000, name: 'Scale' },
};

// ─── Delivery date helper ───
function deliveryDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

// ─── Apply tier logic ───
function applyTiers(tiers, carrierCost) {
  for (const tier of tiers) {
    if (carrierCost <= tier.max_carrier_cost) {
      return {
        price: tier.customer_price,
        serviceName: tier.service_name || (tier.customer_price === 0 ? 'Free Shipping' : 'Standard Shipping'),
      };
    }
  }
  // Fallback: last tier
  const last = tiers[tiers.length - 1];
  return {
    price: last ? last.customer_price : 0,
    serviceName: last ? (last.service_name || 'Standard Shipping') : 'Standard Shipping',
  };
}

// ─── Main rates endpoint ───
router.post('/rates', async function (req, res) {
  try {
    const rate = req.body.rate;
    if (!rate) return res.json({ rates: [] });

    const destination = rate.destination || {};
    const items = rate.items || [];

    // Find the merchant by matching the origin address or shop header
    // Shopify sends X-Shopify-Shop-Domain header
    const shopDomain = req.get('X-Shopify-Shop-Domain') || '';
    let merchant = null;

    if (shopDomain) {
      merchant = queries.getMerchant.get(shopDomain);
    }

    // Fallback: try matching by origin postcode
    if (!merchant && rate.origin) {
      const allMerchants = queries.getAllMerchants.all();
      merchant = allMerchants.find(function (m) {
        return m.origin_postcode === rate.origin.postal_code;
      });
    }

    if (!merchant) {
      console.log('[Rates] Unknown merchant for ' + shopDomain);
      return res.json({ rates: [] });
    }

    // Check credit limit
    const plan = PLANS[merchant.plan] || PLANS.free;
    if (merchant.credits_used >= plan.credits) {
      console.log('[Rates] ' + merchant.shop + ' has exceeded credit limit (' + merchant.credits_used + '/' + plan.credits + ')');
      return res.json({ rates: [] });
    }

    // Get tiers
    const tiers = queries.getTiers.all(merchant.id);
    if (tiers.length === 0) {
      console.log('[Rates] No tiers configured for ' + merchant.shop);
      return res.json({ rates: [] });
    }

    // Calculate total weight
    let totalGrams = 0;
    for (const item of items) {
      totalGrams += (item.grams || 0) * (item.quantity || 1);
    }
    let weightKg = totalGrams / 1000;
    if (weightKg < 0.5) weightKg = 0.5;

    // Only handle AU deliveries for now
    if (destination.country && destination.country !== 'AU') {
      return res.json({ rates: [] });
    }

    // Try each enabled carrier
    const carrierCreds = queries.getAllCarrierCreds.all(merchant.id);
    const enabledCreds = carrierCreds.filter(function (c) { return c.enabled; });

    let carrierCost = null;
    let carrierUsed = null;

    for (const cred of enabledCreds) {
      const carrier = carriers[cred.carrier];
      if (!carrier) continue;

      try {
        const quote = await carrier.getQuote(
          { client_id: cred.client_id, client_secret: cred.client_secret, merchant_id: merchant.id },
          { postcode: merchant.origin_postcode, city: merchant.origin_city, state: merchant.origin_state },
          destination,
          weightKg
        );
        carrierCost = quote.cost;
        carrierUsed = cred.carrier;
        break; // Use first successful quote
      } catch (err) {
        console.error('[Rates] ' + cred.carrier + ' failed for ' + merchant.shop + ': ' + err.message);
      }
    }

    if (carrierCost === null) {
      // No carrier returned a quote — return fallback (highest tier)
      const fallback = tiers[tiers.length - 1];
      return res.json({
        rates: [{
          service_name: 'Standard Shipping',
          service_code: 'SHIPRATE_FALLBACK',
          total_price: Math.round((fallback ? fallback.customer_price : 0) * 100),
          currency: 'AUD',
          min_delivery_date: deliveryDate(5),
          max_delivery_date: deliveryDate(14),
        }],
      });
    }

    // Apply tiers
    const result = applyTiers(tiers, carrierCost);

    // Log usage & increment credits
    queries.logUsage.run({
      merchant_id: merchant.id,
      carrier: carrierUsed,
      origin_postcode: merchant.origin_postcode,
      dest_postcode: destination.postal_code || '',
      carrier_cost: carrierCost,
      customer_price: result.price,
      credits_used: 1,
    });
    queries.incrementCredits.run(merchant.id);

    console.log('[Rates] ' + merchant.shop + ' → ' + destination.postal_code + ': carrier=$' + carrierCost.toFixed(2) + ' → customer=$' + result.price.toFixed(2));

    return res.json({
      rates: [{
        service_name: result.serviceName,
        service_code: 'SHIPRATE_TIERED',
        total_price: Math.round(result.price * 100),
        currency: 'AUD',
        min_delivery_date: deliveryDate(3),
        max_delivery_date: deliveryDate(10),
      }],
    });

  } catch (err) {
    console.error('[Rates] Error:', err.message);
    return res.json({ rates: [] });
  }
});

module.exports = router;
