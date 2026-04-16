/**
 * Merchant dashboard — configure carriers, tiers, view usage
 */

const express = require('express');
const queries = require('../db/queries');
const carriers = require('../carriers');
const { requireAuth } = require('./auth');

const router = express.Router();

// ─── Dashboard home ───
router.get('/dashboard', requireAuth, function (req, res) {
  const merchant = req.merchant;
  const tiers = queries.getTiers.all(merchant.id);
  const creds = queries.getAllCarrierCreds.all(merchant.id);
  const usage = queries.getUsageThisMonth.get(merchant.id);
  const recentLogs = queries.getRecentUsage.all(merchant.id);

  const planLimits = {
    free: 500, starter: 10000, growth: 25000, scale: 75000,
  };
  const creditsLimit = planLimits[merchant.plan] || 500;
  const creditsUsed = merchant.credits_used || 0;
  const creditsPercent = Math.min(100, Math.round((creditsUsed / creditsLimit) * 100));

  res.send(renderDashboard({
    merchant, tiers, creds, usage, recentLogs,
    creditsLimit, creditsUsed, creditsPercent,
    carriers: Object.values(carriers),
    query: req.query,
  }));
});

// ─── Save origin address ───
router.post('/dashboard/origin', requireAuth, function (req, res) {
  queries.updateMerchantOrigin.run({
    id: req.merchant.id,
    origin_city: req.body.origin_city || '',
    origin_state: req.body.origin_state || '',
    origin_postcode: req.body.origin_postcode || '',
    origin_country: req.body.origin_country || 'AU',
  });
  res.redirect('/dashboard?saved=origin');
});

// ─── Save carrier credentials ───
router.post('/dashboard/carrier', requireAuth, function (req, res) {
  queries.upsertCarrierCreds.run({
    merchant_id: req.merchant.id,
    carrier: req.body.carrier,
    client_id: req.body.client_id || '',
    client_secret: req.body.client_secret || '',
    extra_config: req.body.extra_config || '{}',
  });
  res.redirect('/dashboard?saved=carrier');
});

// ─── Save tiers ───
router.post('/dashboard/tiers', requireAuth, function (req, res) {
  const merchantId = req.merchant.id;

  // Delete existing tiers
  queries.deleteTiers.run(merchantId);

  // Parse form data — arrays of values
  const maxCosts = [].concat(req.body.max_cost || []);
  const prices = [].concat(req.body.customer_price || []);
  const names = [].concat(req.body.service_name || []);

  for (let i = 0; i < maxCosts.length; i++) {
    const maxCost = parseFloat(maxCosts[i]);
    const price = prices[i] && prices[i].toLowerCase() === 'free' ? 0 : parseFloat(prices[i]);

    if (isNaN(maxCost) || isNaN(price)) continue;

    queries.insertTier.run({
      merchant_id: merchantId,
      max_carrier_cost: maxCost,
      customer_price: price,
      service_name: names[i] || (price === 0 ? 'Free Shipping' : 'Standard Shipping'),
      sort_order: i,
    });
  }

  res.redirect('/dashboard?saved=tiers');
});

// ─── Render dashboard HTML ───
function renderDashboard(data) {
  const { merchant, tiers, creds, creditsLimit, creditsUsed, creditsPercent, carriers, recentLogs, query } = data;

  const savedMsg = query.saved ? '<div class="sr-toast">✅ Settings saved!</div>' : '';
  const upgradedMsg = query.upgraded ? '<div class="sr-toast">🎉 Upgraded to ' + query.upgraded + '!</div>' : '';

  // Build carrier forms
  const carrierForms = carriers.map(function (carrier) {
    const existing = creds.find(function (c) { return c.carrier === carrier.code; });
    const fields = carrier.fields.map(function (f) {
      const val = existing ? (existing[f.id] || '') : '';
      return '<div class="sr-field">'
        + '<label>' + f.label + '</label>'
        + '<input type="' + (f.type || 'text') + '" name="' + f.id + '" value="' + val + '" placeholder="' + (f.placeholder || '') + '">'
        + '</div>';
    }).join('');

    return '<div class="sr-card">'
      + '<h3>🚚 ' + carrier.name + '</h3>'
      + '<form method="POST" action="/dashboard/carrier">'
      + '<input type="hidden" name="carrier" value="' + carrier.code + '">'
      + fields
      + '<button type="submit" class="sr-btn">Save Carrier</button>'
      + '</form></div>';
  }).join('');

  // Build tier rows
  let tierRows = '';
  if (tiers.length > 0) {
    tiers.forEach(function (t, i) {
      tierRows += '<tr>'
        + '<td><input name="max_cost" type="number" step="0.01" value="' + t.max_carrier_cost + '" required></td>'
        + '<td><input name="customer_price" type="text" value="' + (t.customer_price === 0 ? 'free' : t.customer_price) + '" required></td>'
        + '<td><input name="service_name" type="text" value="' + (t.service_name || '') + '"></td>'
        + '</tr>';
    });
  } else {
    // Default tiers
    tierRows = '<tr><td><input name="max_cost" type="number" step="0.01" value="50"></td><td><input name="customer_price" type="text" value="free"></td><td><input name="service_name" type="text" value="Free Shipping"></td></tr>'
      + '<tr><td><input name="max_cost" type="number" step="0.01" value="90"></td><td><input name="customer_price" type="text" value="45"></td><td><input name="service_name" type="text" value="Standard Shipping"></td></tr>'
      + '<tr><td><input name="max_cost" type="number" step="0.01" value="9999"></td><td><input name="customer_price" type="text" value="95"></td><td><input name="service_name" type="text" value="Standard Shipping"></td></tr>';
  }

  // Recent usage table
  let usageRows = '';
  if (recentLogs && recentLogs.length > 0) {
    recentLogs.slice(0, 20).forEach(function (log) {
      usageRows += '<tr>'
        + '<td>' + (log.created_at || '').replace('T', ' ').substring(0, 19) + '</td>'
        + '<td>' + (log.dest_postcode || '') + '</td>'
        + '<td>$' + (log.carrier_cost ? log.carrier_cost.toFixed(2) : '0') + '</td>'
        + '<td>$' + (log.customer_price ? log.customer_price.toFixed(2) : '0') + '</td>'
        + '</tr>';
    });
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ShipRate — Dashboard</title>
  <link rel="stylesheet" href="/css/dashboard.css">
</head>
<body>
  <nav class="sr-nav">
    <div class="sr-nav__inner">
      <span class="sr-nav__logo">📦 ShipRate</span>
      <span class="sr-nav__shop">${merchant.shop}</span>
      <a href="/logout" class="sr-nav__link">Logout</a>
    </div>
  </nav>

  <div class="sr-container">
    ${savedMsg}${upgradedMsg}

    <!-- Credits Usage -->
    <div class="sr-card">
      <h3>📊 Usage — ${merchant.plan.charAt(0).toUpperCase() + merchant.plan.slice(1)} Plan</h3>
      <div class="sr-progress-wrap">
        <div class="sr-progress">
          <div class="sr-progress__bar" style="width:${creditsPercent}%"></div>
        </div>
        <span class="sr-progress__label">${creditsUsed.toLocaleString()} / ${creditsLimit.toLocaleString()} credits used</span>
      </div>
      ${merchant.plan === 'free' ? '<p class="sr-muted">Upgrade for more credits and priority support.</p>' : ''}
    </div>

    <!-- Plans -->
    <div class="sr-card">
      <h3>💳 Plans</h3>
      <div class="sr-plans">
        <div class="sr-plan ${merchant.plan === 'free' ? 'sr-plan--active' : ''}">
          <h4>Free</h4>
          <div class="sr-plan__price">$0</div>
          <p>500 credits/mo</p>
        </div>
        <div class="sr-plan ${merchant.plan === 'starter' ? 'sr-plan--active' : ''}">
          <h4>Starter</h4>
          <div class="sr-plan__price">$39/mo</div>
          <p>10,000 credits/mo</p>
          ${merchant.plan !== 'starter' ? '<form method="POST" action="/billing/subscribe"><input type="hidden" name="plan" value="starter"><button class="sr-btn sr-btn--sm">Upgrade</button></form>' : '<span class="sr-badge">Current</span>'}
        </div>
        <div class="sr-plan ${merchant.plan === 'growth' ? 'sr-plan--active' : ''}">
          <h4>Growth</h4>
          <div class="sr-plan__price">$69/mo</div>
          <p>25,000 credits/mo</p>
          ${merchant.plan !== 'growth' ? '<form method="POST" action="/billing/subscribe"><input type="hidden" name="plan" value="growth"><button class="sr-btn sr-btn--sm">Upgrade</button></form>' : '<span class="sr-badge">Current</span>'}
        </div>
        <div class="sr-plan ${merchant.plan === 'scale' ? 'sr-plan--active' : ''}">
          <h4>Scale</h4>
          <div class="sr-plan__price">$119/mo</div>
          <p>75,000 credits/mo</p>
          ${merchant.plan !== 'scale' ? '<form method="POST" action="/billing/subscribe"><input type="hidden" name="plan" value="scale"><button class="sr-btn sr-btn--sm">Upgrade</button></form>' : '<span class="sr-badge">Current</span>'}
        </div>
      </div>
    </div>

    <!-- Origin Address -->
    <div class="sr-card">
      <h3>📍 Origin / Warehouse Address</h3>
      <form method="POST" action="/dashboard/origin">
        <div class="sr-grid-2">
          <div class="sr-field">
            <label>City</label>
            <input name="origin_city" value="${merchant.origin_city || ''}" placeholder="Brisbane">
          </div>
          <div class="sr-field">
            <label>State</label>
            <input name="origin_state" value="${merchant.origin_state || ''}" placeholder="QLD">
          </div>
          <div class="sr-field">
            <label>Postcode</label>
            <input name="origin_postcode" value="${merchant.origin_postcode || ''}" placeholder="4000">
          </div>
          <div class="sr-field">
            <label>Country</label>
            <input name="origin_country" value="${merchant.origin_country || 'AU'}" placeholder="AU">
          </div>
        </div>
        <button type="submit" class="sr-btn">Save Origin</button>
      </form>
    </div>

    <!-- Carrier Credentials -->
    ${carrierForms}

    <!-- Shipping Tiers -->
    <div class="sr-card">
      <h3>💰 Shipping Tiers</h3>
      <p class="sr-muted">Set what the customer pays based on what the carrier quotes. Use "free" or "0" for free shipping.</p>
      <form method="POST" action="/dashboard/tiers">
        <table class="sr-table" id="sr-tiers-table">
          <thead>
            <tr>
              <th>If carrier quotes up to ($)</th>
              <th>Customer pays ($)</th>
              <th>Label shown at checkout</th>
            </tr>
          </thead>
          <tbody>
            ${tierRows}
          </tbody>
        </table>
        <div class="sr-tier-actions">
          <button type="button" class="sr-btn sr-btn--outline" onclick="addTierRow()">+ Add Tier</button>
          <button type="submit" class="sr-btn">Save Tiers</button>
        </div>
      </form>
    </div>

    <!-- Recent Quotes -->
    <div class="sr-card">
      <h3>📋 Recent Quotes</h3>
      <table class="sr-table">
        <thead>
          <tr><th>Time</th><th>Destination</th><th>Carrier Cost</th><th>Customer Charged</th></tr>
        </thead>
        <tbody>
          ${usageRows || '<tr><td colspan="4" class="sr-muted">No quotes yet</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    function addTierRow() {
      var tbody = document.querySelector('#sr-tiers-table tbody');
      var row = document.createElement('tr');
      row.innerHTML = '<td><input name="max_cost" type="number" step="0.01" required></td>'
        + '<td><input name="customer_price" type="text" required></td>'
        + '<td><input name="service_name" type="text" value="Standard Shipping"></td>';
      tbody.appendChild(row);
    }
  </script>
</body>
</html>`;
}

module.exports = router;
