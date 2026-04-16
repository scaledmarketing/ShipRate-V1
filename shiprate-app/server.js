/**
 * ShipRate — Smart Shipping Rates for Shopify
 * Main entry point
 */

require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

// ── Initialise database (creates tables if needed) ──
require('./db/init');

// ── Import routes ──
const { router: authRouter } = require('./routes/auth');
const dashboardRouter = require('./routes/dashboard');
const ratesRouter = require('./routes/rates');
const billingRouter = require('./routes/billing');

// ── App setup ──
const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway / render proxy for HTTPS cookies
app.set('trust proxy', 1);

// ── Middleware ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files (CSS, images, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Request logging (lightweight)
app.use(function (req, res, next) {
  if (req.path !== '/health') {
    console.log('[' + new Date().toISOString().substring(11, 19) + '] ' + req.method + ' ' + req.path);
  }
  next();
});

// ── Landing page ──
app.get('/', function (req, res) {
  const landingPath = path.join(__dirname, 'views', 'landing.html');
  res.sendFile(landingPath);
});

// ── Routes ──
app.use(authRouter);
app.use(dashboardRouter);
app.use(ratesRouter);
app.use(billingRouter);

// ── Health check (for Railway / uptime monitors) ──
app.get('/health', function (req, res) {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

// ── GDPR mandatory webhooks (Shopify requires these) ──
app.post('/webhooks/customers/data_request', function (req, res) {
  // Customer data request — we don't store customer PII
  console.log('[GDPR] Customer data request received');
  res.status(200).json({ ok: true });
});

app.post('/webhooks/customers/redact', function (req, res) {
  // Customer data erasure — we don't store customer PII
  console.log('[GDPR] Customer redact received');
  res.status(200).json({ ok: true });
});

app.post('/webhooks/shop/redact', function (req, res) {
  // Shop data erasure — clean up merchant data
  const body = req.body;
  const shopDomain = body.shop_domain;

  if (shopDomain) {
    try {
      const queries = require('./db/queries');
      const merchant = queries.getMerchant.get(shopDomain);
      if (merchant) {
        // Delete all merchant data
        queries.deleteTiers.run(merchant.id);
        // Could add more cleanup here
        console.log('[GDPR] Shop redacted: ' + shopDomain);
      }
    } catch (err) {
      console.error('[GDPR] Redact error:', err.message);
    }
  }

  res.status(200).json({ ok: true });
});

// ── App uninstall webhook ──
app.post('/webhooks/app/uninstalled', function (req, res) {
  const body = req.body;
  const shopDomain = (req.get('X-Shopify-Shop-Domain') || '').trim();

  if (shopDomain) {
    try {
      const queries = require('./db/queries');
      const merchant = queries.getMerchant.get(shopDomain);
      if (merchant) {
        console.log('[Webhook] App uninstalled from ' + shopDomain);
        // Reset plan to free, clear token
        queries.updateMerchantPlan.run({
          id: merchant.id,
          plan: 'free',
          credits_limit: 500,
          billing_charge_id: null,
          billing_status: 'uninstalled',
        });
      }
    } catch (err) {
      console.error('[Webhook] Uninstall error:', err.message);
    }
  }

  res.status(200).json({ ok: true });
});

// ── 404 ──
app.use(function (req, res) {
  res.status(404).send('Not found');
});

// ── Error handler ──
app.use(function (err, req, res, next) {
  console.error('[Error]', err.message);
  res.status(500).send('Internal server error');
});

// ── Start server ──
app.listen(PORT, function () {
  console.log('');
  console.log('  📦 ShipRate running on port ' + PORT);
  console.log('  🌐 ' + (process.env.APP_URL || 'http://localhost:' + PORT));
  console.log('');
});
