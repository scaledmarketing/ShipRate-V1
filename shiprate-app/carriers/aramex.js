/**
 * Aramex Australia carrier integration
 */

const fetch = require('node-fetch');

const TOKEN_URL = 'https://identity.aramexconnect.com.au/connect/token';
const API_BASE = 'https://api.myfastway.com.au';
const SCOPE = 'ac-api-au';

// In-memory token cache per merchant
const tokenCache = {};

async function getToken(clientId, clientSecret, merchantId) {
  const cached = tokenCache[merchantId];
  if (cached && Date.now() < cached.expiresAt - 300000) {
    return cached.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: SCOPE,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error('Aramex token failed (' + res.status + '): ' + text);
  }

  const data = await res.json();
  tokenCache[merchantId] = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };

  return data.access_token;
}

async function getQuote(credentials, origin, destination, weightKg) {
  const token = await getToken(credentials.client_id, credentials.client_secret, credentials.merchant_id);

  const quoteBody = {
    To: {
      Address: {
        StreetAddress: destination.address1 || '',
        Locality: destination.city || '',
        StateOrProvince: destination.province || '',
        PostalCode: destination.postal_code || '',
        Country: destination.country || 'AU',
      },
    },
    Items: [
      {
        Quantity: 1,
        PackageType: 'P',
        WeightDead: weightKg,
      },
    ],
  };

  const res = await fetch(API_BASE + '/api/consignments/quote', {
    method: 'POST',
    headers: {
      'Authorization': 'bearer ' + token,
      'Content-Type': 'application/json',
      'api-version': '1.0',
    },
    body: JSON.stringify(quoteBody),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error('Aramex quote failed (' + res.status + '): ' + text);
  }

  const data = await res.json();
  const total = data.data ? data.data.total : null;

  if (total === null || total === undefined) {
    throw new Error('Aramex returned no price: ' + JSON.stringify(data));
  }

  return {
    carrier: 'aramex',
    cost: total,
    currency: 'AUD',
  };
}

module.exports = {
  name: 'Aramex Australia',
  code: 'aramex',
  getQuote,
  fields: [
    { id: 'client_id', label: 'Client ID', type: 'text', placeholder: 'From aramexconnect.com.au → Admin → API Keys' },
    { id: 'client_secret', label: 'Client Secret', type: 'password', placeholder: 'Your API secret' },
  ],
};
