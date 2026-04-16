/**
 * Database query helpers
 */

const db = require('./init');

const queries = {

  // ─── Merchants ───
  getMerchant: db.prepare('SELECT * FROM merchants WHERE shop = ?'),
  getMerchantById: db.prepare('SELECT * FROM merchants WHERE id = ?'),

  upsertMerchant: db.prepare(`
    INSERT INTO merchants (shop, access_token, scope)
    VALUES (@shop, @access_token, @scope)
    ON CONFLICT(shop) DO UPDATE SET
      access_token = @access_token,
      scope = @scope,
      updated_at = datetime('now')
  `),

  updateMerchantOrigin: db.prepare(`
    UPDATE merchants SET
      origin_city = @origin_city,
      origin_state = @origin_state,
      origin_postcode = @origin_postcode,
      origin_country = @origin_country,
      updated_at = datetime('now')
    WHERE id = @id
  `),

  updateMerchantPlan: db.prepare(`
    UPDATE merchants SET
      plan = @plan,
      credits_limit = @credits_limit,
      billing_charge_id = @billing_charge_id,
      billing_status = @billing_status,
      updated_at = datetime('now')
    WHERE id = @id
  `),

  updateCarrierServiceId: db.prepare(`
    UPDATE merchants SET carrier_service_id = @carrier_service_id WHERE id = @id
  `),

  incrementCredits: db.prepare(`
    UPDATE merchants SET credits_used = credits_used + 1 WHERE id = ?
  `),

  resetMonthlyCredits: db.prepare(`
    UPDATE merchants SET credits_used = 0
  `),

  getAllMerchants: db.prepare('SELECT * FROM merchants'),

  // ─── Carrier Credentials ───
  getCarrierCreds: db.prepare(`
    SELECT * FROM carrier_credentials WHERE merchant_id = ? AND carrier = ?
  `),

  getAllCarrierCreds: db.prepare(`
    SELECT * FROM carrier_credentials WHERE merchant_id = ?
  `),

  upsertCarrierCreds: db.prepare(`
    INSERT INTO carrier_credentials (merchant_id, carrier, client_id, client_secret, extra_config)
    VALUES (@merchant_id, @carrier, @client_id, @client_secret, @extra_config)
    ON CONFLICT(merchant_id, carrier) DO UPDATE SET
      client_id = @client_id,
      client_secret = @client_secret,
      extra_config = @extra_config
  `),

  toggleCarrier: db.prepare(`
    UPDATE carrier_credentials SET enabled = @enabled WHERE merchant_id = @merchant_id AND carrier = @carrier
  `),

  // ─── Shipping Tiers ───
  getTiers: db.prepare(`
    SELECT * FROM shipping_tiers WHERE merchant_id = ? ORDER BY sort_order ASC, max_carrier_cost ASC
  `),

  deleteTiers: db.prepare(`
    DELETE FROM shipping_tiers WHERE merchant_id = ?
  `),

  insertTier: db.prepare(`
    INSERT INTO shipping_tiers (merchant_id, max_carrier_cost, customer_price, service_name, sort_order)
    VALUES (@merchant_id, @max_carrier_cost, @customer_price, @service_name, @sort_order)
  `),

  // ─── Usage ───
  logUsage: db.prepare(`
    INSERT INTO usage_log (merchant_id, carrier, origin_postcode, dest_postcode, carrier_cost, customer_price, credits_used)
    VALUES (@merchant_id, @carrier, @origin_postcode, @dest_postcode, @carrier_cost, @customer_price, @credits_used)
  `),

  getUsageThisMonth: db.prepare(`
    SELECT COUNT(*) as count, SUM(credits_used) as total_credits
    FROM usage_log
    WHERE merchant_id = ? AND created_at >= date('now', 'start of month')
  `),

  getRecentUsage: db.prepare(`
    SELECT * FROM usage_log WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 50
  `),
};

module.exports = queries;
