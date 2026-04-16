/**
 * Shopify OAuth routes — handles app install and token exchange
 */

const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const queries = require('../db/queries');

const router = express.Router();

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const APP_URL = process.env.APP_URL;
const SCOPES = 'write_shipping,read_shipping';

// ─── Install / Auth entry point ───
// Merchants visit: /auth?shop=their-store.myshopify.com
router.get('/auth', function (req, res) {
  const shop = req.query.shop;
  if (!shop || !shop.match(/^[a-zA-Z0-9-]+\.myshopify\.com$/)) {
    return res.status(400).send('Invalid shop parameter. Use: ?shop=your-store.myshopify.com');
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  res.cookie('shopify_nonce', nonce, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600000 });

  const redirectUri = APP_URL + '/auth/callback';
  const installUrl = 'https://' + shop + '/admin/oauth/authorize'
    + '?client_id=' + CLIENT_ID
    + '&scope=' + SCOPES
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&state=' + nonce;

  res.redirect(installUrl);
});

// ─── OAuth callback ───
router.get('/auth/callback', async function (req, res) {
  const { code, shop, state, hmac } = req.query;
  const nonce = req.cookies.shopify_nonce;

  // Verify state
  if (!state || state !== nonce) {
    return res.status(403).send('State mismatch. Please try installing again.');
  }

  // Verify HMAC
  if (hmac) {
    const params = Object.assign({}, req.query);
    delete params.hmac;
    const sorted = Object.keys(params).sort().map(k => k + '=' + params[k]).join('&');
    const computed = crypto.createHmac('sha256', CLIENT_SECRET).update(sorted).digest('hex');
    if (computed !== hmac) {
      return res.status(403).send('HMAC verification failed.');
    }
  }

  try {
    // Exchange code for token
    const tokenRes = await fetch('https://' + shop + '/admin/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('[Auth] Token exchange failed:', tokenData);
      return res.status(500).send('Failed to get access token from Shopify.');
    }

    // Save merchant
    queries.upsertMerchant.run({
      shop: shop,
      access_token: tokenData.access_token,
      scope: tokenData.scope || SCOPES,
    });

    const merchant = queries.getMerchant.get(shop);

    // Register carrier service if not already registered
    if (!merchant.carrier_service_id) {
      const carrierRes = await fetch('https://' + shop + '/admin/api/2024-01/carrier_services.json', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': tokenData.access_token,
        },
        body: JSON.stringify({
          carrier_service: {
            name: 'ShipRate',
            callback_url: APP_URL + '/rates',
            service_discovery: true,
            format: 'json',
          },
        }),
      });

      const carrierData = await carrierRes.json();
      if (carrierData.carrier_service) {
        queries.updateCarrierServiceId.run({
          id: merchant.id,
          carrier_service_id: String(carrierData.carrier_service.id),
        });
        console.log('[Auth] Carrier service registered for ' + shop + ' (ID: ' + carrierData.carrier_service.id + ')');
      } else {
        console.error('[Auth] Carrier registration failed:', carrierData);
      }
    }

    // Set session cookie
    const sessionToken = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'fallback-secret')
      .update(shop + ':' + merchant.id)
      .digest('hex');
    res.cookie('shiprate_session', shop + ':' + sessionToken, {
      httpOnly: true, secure: true, sameSite: 'lax', maxAge: 86400000 * 30
    });

    console.log('[Auth] ✅ ' + shop + ' installed successfully');
    res.redirect('/dashboard');

  } catch (err) {
    console.error('[Auth] Error:', err.message);
    res.status(500).send('Installation failed: ' + err.message);
  }
});

// ─── Session middleware ───
function requireAuth(req, res, next) {
  const cookie = req.cookies.shiprate_session;
  if (!cookie) return res.redirect('/');

  const parts = cookie.split(':');
  // parts[0] and [1] are shop (could contain colons), last part is token
  // Actually shop is like xxx.myshopify.com so no extra colons
  const shop = parts[0];
  const token = parts[1];

  const merchant = queries.getMerchant.get(shop);
  if (!merchant) return res.redirect('/');

  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'fallback-secret')
    .update(shop + ':' + merchant.id)
    .digest('hex');

  if (token !== expected) return res.redirect('/');

  req.merchant = merchant;
  next();
}

router.get('/logout', function (req, res) {
  res.clearCookie('shiprate_session');
  res.redirect('/');
});

module.exports = { router, requireAuth };
