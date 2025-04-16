// server.js
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// === App setup ===
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

app.use(cors({
  origin: [
    'http://localhost:3000',
    // allow your Chrome extension too:
    /^chrome-extension:\/\/.+$/
  ],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

// === Google Sheets client init ===
let sheetsClient = null;
let SHEET_TAB_NAME = null;

function getServiceAccountCredentials() {
  return {
    type: process.env.SERVICE_ACCOUNT_TYPE,
    project_id: process.env.SERVICE_ACCOUNT_PROJECT_ID,
    private_key_id: process.env.SERVICE_ACCOUNT_PRIVATE_KEY_ID,
    private_key: process.env.SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.SERVICE_ACCOUNT_CLIENT_EMAIL,
    client_id: process.env.SERVICE_ACCOUNT_CLIENT_ID,
    auth_uri: process.env.SERVICE_ACCOUNT_AUTH_URI,
    token_uri: process.env.SERVICE_ACCOUNT_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.SERVICE_ACCOUNT_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.SERVICE_ACCOUNT_CLIENT_X509_CERT_URL
  };
}

async function initializeSheetsClient() {
  const creds = getServiceAccountCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const client = await auth.getClient();
  sheetsClient = google.sheets({ version: 'v4', auth: client });

  // Grab first sheet name
  const meta = await sheetsClient.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
  SHEET_TAB_NAME = meta.data.sheets[0].properties.title;
  console.log(`✅ Sheets initialized, using tab "${SHEET_TAB_NAME}"`);
}

// === Helpers ===
function calculateDaysRemaining(endDateStr) {
  const now = new Date();
  const end = new Date(endDateStr);
  if (isNaN(end)) return null;
  if (end < now) return 0;
  return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
}

async function checkUserPremiumStatus(email) {
  if (!email) {
    return { isPremium: false, isInSheet: false, message: 'No email provided' };
  }

  if (!sheetsClient || !SHEET_TAB_NAME) {
    await initializeSheetsClient();
  }

  const resp = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_TAB_NAME}!A:G`
  });
  const rows = resp.data.values || [];
  if (rows.length < 2) {
    return { isPremium: false, isInSheet: false, message: 'No data found' };
  }

  // Find header indexes
  const headers = rows[0].map(h => h.toLowerCase().trim());
  const emailIdx   = headers.findIndex(h => h.includes('email'));
  const cancelIdx  = headers.findIndex(h => h.includes('cancel'));
  const endIdx     = headers.findIndex(h => h.includes('end date'));
  const startIdx   = headers.findIndex(h => h.includes('start'));

  if ([emailIdx, cancelIdx, endIdx].some(i => i < 0)) {
    return { isPremium: false, isInSheet: false, message: 'Sheet missing required columns' };
  }

  const normalized = email.toLowerCase().trim();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if ((row[emailIdx] || '').toLowerCase().trim() === normalized) {
      const isCancelled = (row[cancelIdx] || '').toLowerCase() === 'true';
      const endRaw      = (row[endIdx] || '').trim() || null;
      const daysRem     = endRaw ? calculateDaysRemaining(endRaw) : null;

      let isPremium = false, reason = '';
      if (endRaw) {
        const endDate = new Date(endRaw);
        if (endDate >= new Date()) {
          isPremium = true;
          reason = isCancelled
            ? `Premium until ${endRaw} despite cancellation`
            : `Active subscription until ${endRaw}`;
        } else {
          reason = `Subscription expired on ${endRaw}`;
        }
      } else {
        // lifetime
        isPremium = !isCancelled;
        reason = isCancelled
          ? 'Lifetime subscription cancelled'
          : 'Lifetime subscription active';
      }

      return {
        isPremium,
        isInSheet: true,
        subscriptionData: {
          startDate: row[startIdx] || null,
          endDate: endRaw,
          isCancelled,
          daysRemaining: daysRem,
          reason
        }
      };
    }
  }

  return { isPremium: false, isInSheet: false, message: 'User not found' };
}

// === Auth middleware ===
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// === Routes ===
// Health check
app.get('/api/test', (_, res) => res.json({ status: 'OK' }));

// Verify & issue JWT (30s lifespan)
app.post('/api/verify-user', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const status = await checkUserPremiumStatus(email);
    const resp = {
      email,
      isPremium: status.isPremium,
      isInSheet: status.isInSheet,
      subscriptionData: status.subscriptionData,
      message: status.message
    };

    if (status.isInSheet) {
      resp.token = jwt.sign(
        { email, isPremium: status.isPremium, isInSheet: true },
        JWT_SECRET,
        { expiresIn: '30s' }           // ← short TTL
      );
    }

    res.json(resp);
  } catch (err) {
    console.error('verify-user error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// Chat endpoint (must match token ↔ email)
app.post('/api/chat', authenticateToken, async (req, res) => {
  const { email, message } = req.body;
  if (!email || !message) {
    return res.status(400).json({ error: 'Email and message are required' });
  }

  // enforce that the JWT’s email matches the payload
  if (req.user.email !== email) {
    return res.status(403).json({
      error: 'Authentication error',
      reason: 'Token email mismatch'
    });
  }

  try {
    const status = await checkUserPremiumStatus(email);
    if (!status.isInSheet) {
      return res.status(403).json({ error: 'Not a premium user', reason: 'User not found' });
    }
    if (!status.isPremium) {
      return res.status(403).json({
        error: 'Subscription expired',
        reason: status.subscriptionData.reason
      });
    }

    // Simulated AI reply
    res.json({
      response: `AI says: "${message}"`,
      subscriptionInfo: {
        endDate: status.subscriptionData.endDate,
        daysRemaining: status.subscriptionData.daysRemaining
      }
    });
  } catch (err) {
    console.error('chat error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// === Start server ===
app.listen(PORT, async () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
  await initializeSheetsClient();
});
