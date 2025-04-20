// // server.js
// const express = require('express');
// const cors = require('cors');
// const { google } = require('googleapis');
// const jwt = require('jsonwebtoken');
// require('dotenv').config();

// // === App setup ===
// const app = express();
// const PORT = process.env.PORT || 3000;
// const JWT_SECRET = process.env.JWT_SECRET;
// const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// app.use(cors({
//   origin: [
//     'http://localhost:3000',
//     // allow your Chrome extension too:
//     /^chrome-extension:\/\/.+$/
//   ],
//   methods: ['GET', 'POST'],
//   credentials: true
// }));
// app.use(express.json());

// // === Google Sheets client init ===
// let sheetsClient = null;
// let SHEET_TAB_NAME = null;

// function getServiceAccountCredentials() {
//   return {
//     type: process.env.SERVICE_ACCOUNT_TYPE,
//     project_id: process.env.SERVICE_ACCOUNT_PROJECT_ID,
//     private_key_id: process.env.SERVICE_ACCOUNT_PRIVATE_KEY_ID,
//     private_key: process.env.SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
//     client_email: process.env.SERVICE_ACCOUNT_CLIENT_EMAIL,
//     client_id: process.env.SERVICE_ACCOUNT_CLIENT_ID,
//     auth_uri: process.env.SERVICE_ACCOUNT_AUTH_URI,
//     token_uri: process.env.SERVICE_ACCOUNT_TOKEN_URI,
//     auth_provider_x509_cert_url: process.env.SERVICE_ACCOUNT_AUTH_PROVIDER_X509_CERT_URL,
//     client_x509_cert_url: process.env.SERVICE_ACCOUNT_CLIENT_X509_CERT_URL
//   };
// }

// async function initializeSheetsClient() {
//   const creds = getServiceAccountCredentials();
//   const auth = new google.auth.GoogleAuth({
//     credentials: creds,
//     scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
//   });
//   const client = await auth.getClient();
//   sheetsClient = google.sheets({ version: 'v4', auth: client });

//   // Grab first sheet name
//   const meta = await sheetsClient.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
//   SHEET_TAB_NAME = meta.data.sheets[0].properties.title;
//   console.log(`✅ Sheets initialized, using tab "${SHEET_TAB_NAME}"`);
// }

// // === Helpers ===
// function calculateDaysRemaining(endDateStr) {
//   const now = new Date();
//   const end = new Date(endDateStr);
//   if (isNaN(end)) return null;
//   if (end < now) return 0;
//   return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
// }

// async function checkUserPremiumStatus(email) {
//   if (!email) {
//     return { isPremium: false, isInSheet: false, message: 'No email provided' };
//   }

//   if (!sheetsClient || !SHEET_TAB_NAME) {
//     await initializeSheetsClient();
//   }

//   const resp = await sheetsClient.spreadsheets.values.get({
//     spreadsheetId: GOOGLE_SHEET_ID,
//     range: `${SHEET_TAB_NAME}!A:G`
//   });
//   const rows = resp.data.values || [];
//   if (rows.length < 2) {
//     return { isPremium: false, isInSheet: false, message: 'No data found' };
//   }

//   // Find header indexes
//   const headers = rows[0].map(h => h.toLowerCase().trim());
//   const emailIdx   = headers.findIndex(h => h.includes('email'));
//   const cancelIdx  = headers.findIndex(h => h.includes('cancel'));
//   const endIdx     = headers.findIndex(h => h.includes('end date'));
//   const startIdx   = headers.findIndex(h => h.includes('start'));

//   if ([emailIdx, cancelIdx, endIdx].some(i => i < 0)) {
//     return { isPremium: false, isInSheet: false, message: 'Sheet missing required columns' };
//   }

//   const normalized = email.toLowerCase().trim();
//   for (let i = 1; i < rows.length; i++) {
//     const row = rows[i];
//     if ((row[emailIdx] || '').toLowerCase().trim() === normalized) {
//       const isCancelled = (row[cancelIdx] || '').toLowerCase() === 'true';
//       const endRaw      = (row[endIdx] || '').trim() || null;
//       const daysRem     = endRaw ? calculateDaysRemaining(endRaw) : null;

//       let isPremium = false, reason = '';
//       if (endRaw) {
//         const endDate = new Date(endRaw);
//         if (endDate >= new Date()) {
//           isPremium = true;
//           reason = isCancelled
//             ? `Premium until ${endRaw} despite cancellation`
//             : `Active subscription until ${endRaw}`;
//         } else {
//           reason = `Subscription expired on ${endRaw}`;
//         }
//       } else {
//         // lifetime
//         isPremium = !isCancelled;
//         reason = isCancelled
//           ? 'Lifetime subscription cancelled'
//           : 'Lifetime subscription active';
//       }

//       return {
//         isPremium,
//         isInSheet: true,
//         subscriptionData: {
//           startDate: row[startIdx] || null,
//           endDate: endRaw,
//           isCancelled,
//           daysRemaining: daysRem,
//           reason
//         }
//       };
//     }
//   }

//   return { isPremium: false, isInSheet: false, message: 'User not found' };
// }

// // === Auth middleware ===
// function authenticateToken(req, res, next) {
//   const authHeader = req.headers.authorization || '';
//   const token = authHeader.split(' ')[1];
//   if (!token) return res.status(401).json({ error: 'No token provided' });

//   jwt.verify(token, JWT_SECRET, (err, user) => {
//     if (err) return res.status(403).json({ error: 'Invalid or expired token' });
//     req.user = user;
//     next();
//   });
// }

// // === Routes ===
// // Health check
// app.get('/api/test', (_, res) => res.json({ status: 'OK' }));

// // Verify & issue JWT (30s lifespan)
// app.post('/api/verify-user', async (req, res) => {
//   const { email } = req.body;
//   if (!email) return res.status(400).json({ error: 'Email is required' });

//   try {
//     const status = await checkUserPremiumStatus(email);
//     const resp = {
//       email,
//       isPremium: status.isPremium,
//       isInSheet: status.isInSheet,
//       subscriptionData: status.subscriptionData,
//       message: status.message
//     };

//     if (status.isInSheet) {
//       resp.token = jwt.sign(
//         { email, isPremium: status.isPremium, isInSheet: true },
//         JWT_SECRET,
//         { expiresIn: '30s' }           // ← short TTL
//       );
//     }

//     res.json(resp);
//   } catch (err) {
//     console.error('verify-user error:', err);
//     res.status(500).json({ error: 'Server error', message: err.message });
//   }
// });

// // Chat endpoint (must match token ↔ email)
// app.post('/api/chat', authenticateToken, async (req, res) => {
//   const { email, message } = req.body;
//   if (!email || !message) {
//     return res.status(400).json({ error: 'Email and message are required' });
//   }

//   // enforce that the JWT’s email matches the payload
//   if (req.user.email !== email) {
//     return res.status(403).json({
//       error: 'Authentication error',
//       reason: 'Token email mismatch'
//     });
//   }

//   try {
//     const status = await checkUserPremiumStatus(email);
//     if (!status.isInSheet) {
//       return res.status(403).json({ error: 'Not a premium user', reason: 'User not found' });
//     }
//     if (!status.isPremium) {
//       return res.status(403).json({
//         error: 'Subscription expired',
//         reason: status.subscriptionData.reason
//       });
//     }

//     // Simulated AI reply
//     res.json({
//       response: `AI says: "${message}"`,
//       subscriptionInfo: {
//         endDate: status.subscriptionData.endDate,
//         daysRemaining: status.subscriptionData.daysRemaining
//       }
//     });
//   } catch (err) {
//     console.error('chat error:', err);
//     res.status(500).json({ error: 'Server error', message: err.message });
//   }
// });

// // === Start server ===
// app.listen(PORT, async () => {
//   console.log(`🚀 Server listening on http://localhost:${PORT}`);
//   await initializeSheetsClient();
// });
// server.js - Main server application with secure token management
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');  // Add this for secure token generation
require('dotenv').config();

// === App setup ===
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const AUTH_TOKEN = process.env.AUTH_TOKEN || "mysecrettoken123"; // For transition period

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

// === Token management (NEW) ===
// Store active tokens (in production, use Redis or a database)
const activeTokens = new Map();

// Generate a secure token (NEW)
function generateSecureToken(email, isPremium) {
  // Create random token
  const token = crypto.randomBytes(32).toString('hex');
  const refreshToken = crypto.randomBytes(32).toString('hex');
  const expiration = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
  
  // Store token with user info
  activeTokens.set(token, {
    email,
    isPremium,
    expiration,
    refreshToken
  });
  
  // Store refresh token mapping
  activeTokens.set(refreshToken, {
    email,
    isPremium,
    isRefreshToken: true,
    parentToken: token
  });
  
  return { token, refreshToken, expiration };
}

// === Rate Limiting ===
const apiRateLimits = {
  // Map to store counts by IP + endpoint
  requestCounts: new Map(),
  
  // Rate limit settings
  limits: {
    '/api/auth/token': { maxRequests: 5, windowMs: 60 * 1000 }, // 5 requests per minute
    '/api/refresh-token': { maxRequests: 10, windowMs: 60 * 1000 }, // 10 requests per minute
    '/api/verify-token': { maxRequests: 20, windowMs: 60 * 1000 }, // 20 requests per minute
    '/api/chat': { maxRequests: 30, windowMs: 60 * 1000 }, // 30 requests per minute
    'default': { maxRequests: 60, windowMs: 60 * 1000 } // Default: 60 requests per minute
  },
  
  // Check if request is allowed
  isAllowed(ip, endpoint) {
    const key = `${ip}:${endpoint}`;
    const now = Date.now();
    const settings = this.limits[endpoint] || this.limits.default;
    
    // Get or create tracking record
    let record = this.requestCounts.get(key);
    if (!record) {
      record = {
        count: 0,
        resetAt: now + settings.windowMs
      };
      this.requestCounts.set(key, record);
    }
    
    // Reset if window has passed
    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + settings.windowMs;
    }
    
    // Check limit
    if (record.count >= settings.maxRequests) {
      return false;
    }
    
    // Increment counter
    record.count++;
    return true;
  },
  
  // Clean up old records
  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.requestCounts.entries()) {
      if (now > record.resetAt) {
        this.requestCounts.delete(key);
      }
    }
  }
};

// Periodically clean up rate limiting records
setInterval(() => apiRateLimits.cleanup(), 5 * 60 * 1000);

// Rate limiting middleware
function rateLimiter(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const endpoint = req.path;
  
  if (!apiRateLimits.isAllowed(ip, endpoint)) {
    return res.status(429).json({ 
      error: 'Rate limit exceeded. Please try again later.' 
    });
  }
  
  next();
}

// Apply rate limiting to all API routes
app.use('/api/', rateLimiter);

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
// Existing JWT authentication
function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// Static token verification middleware
function verifyStaticToken(req, res, next) {
  const token = req.headers['x-auth-token'];
  
  if (!token || token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
  
  next();
}

// Dynamic token verification middleware
function verifyDynamicToken(req, res, next) {
  const token = req.headers['x-auth-token'] || req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  // Check for static token first (for backward compatibility)
  if (token === AUTH_TOKEN) {
    return next();
  }
  
  // Verify dynamic token
  const tokenData = activeTokens.get(token);
  
  if (!tokenData) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  if (tokenData.isRefreshToken) {
    return res.status(401).json({ error: 'Cannot use refresh token for authentication' });
  }
  
  if (tokenData.expiration < Date.now()) {
    // Token expired, remove it
    activeTokens.delete(token);
    
    // Also remove associated refresh token
    if (tokenData.refreshToken) {
      activeTokens.delete(tokenData.refreshToken);
    }
    
    return res.status(401).json({ error: 'Token expired' });
  }
  
  // Add user info to request
  req.user = {
    email: tokenData.email,
    isPremium: tokenData.isPremium
  };
  
  next();
}

// === Routes ===
// Health check
app.get('/api/test', (_, res) => res.json({ status: 'OK' }));

// Verify & issue JWT (with enhanced security)
app.post('/api/verify-user', async (req, res) => {
  const { email, googleToken } = req.body;
  
  // Validate request
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  // Verify Google token if provided
  if (googleToken) {
    try {
      // In a production scenario, verify the Google token
      // For example, use Google's OAuth2 API to verify
      // This is a placeholder for that verification
    } catch (err) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }
  }

  try {
    const status = await checkUserPremiumStatus(email);
    
    // Generate secure tokens
    const { token, refreshToken, expiration } = generateSecureToken(email, status.isPremium);
    
    // Create response object
    const resp = {
      email,
      isPremium: status.isPremium,
      isInSheet: status.isInSheet,
      subscriptionData: status.subscriptionData,
      token,
      refreshToken,
      expiresAt: expiration
    };
    
    // Add the JWT token (for backward compatibility)
    if (status.isInSheet) {
      resp.jwtToken = jwt.sign(
        { email, isPremium: status.isPremium, isInSheet: true },
        JWT_SECRET,
        { expiresIn: '30s' }
      );
    }
    
    res.json(resp);
  } catch (err) {
    console.error('verify-user error:', err);
    res.status(500).json({ error: 'Server error', message: 'An internal error occurred' });
  }
});

// Token generation endpoint
app.post('/api/auth/token', verifyStaticToken, async (req, res) => {
  const { email, googleToken } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }
  
  // Verify Google token if provided
  if (googleToken) {
    try {
      // In a production scenario, verify the Google token
      // For example, use Google's OAuth2 API to verify
      // This is a placeholder for that verification
    } catch (err) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }
  }
  
  try {
    // Check if user exists and get premium status
    const userStatus = await checkUserPremiumStatus(email);
    
    if (!userStatus.isInSheet) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Generate token
    const { token, refreshToken, expiration } = generateSecureToken(email, userStatus.isPremium);
    
    // Return token info
    res.json({
      token,
      refreshToken,
      expiresAt: expiration,
      isPremium: userStatus.isPremium
    });
  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Token verification endpoint
app.post('/api/verify-token', (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }
  
  // Support static token for backward compatibility
  if (token === AUTH_TOKEN) {
    return res.json({
      isValid: true,
      isPremium: true // Static token grants premium access
    });
  }
  
  const tokenData = activeTokens.get(token);
  
  if (!tokenData) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  if (tokenData.isRefreshToken) {
    return res.status(401).json({ error: 'Cannot verify a refresh token' });
  }
  
  if (tokenData.expiration < Date.now()) {
    // Token expired, remove it
    activeTokens.delete(token);
    return res.status(401).json({ error: 'Token expired' });
  }
  
  // Return user info
  res.json({
    isValid: true,
    email: tokenData.email,
    isPremium: tokenData.isPremium
  });
});

// Refresh token endpoint
app.post('/api/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }
  
  const tokenData = activeTokens.get(refreshToken);
  
  if (!tokenData || !tokenData.isRefreshToken) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
  
  try {
    // Verify email and premium status
    const status = await checkUserPremiumStatus(tokenData.email);
    
    if (!status.isInSheet) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Invalidate old tokens
    if (tokenData.parentToken) {
      activeTokens.delete(tokenData.parentToken);
    }
    activeTokens.delete(refreshToken);
    
    // Generate new token
    const { token, refreshToken: newRefreshToken, expiration } = 
      generateSecureToken(tokenData.email, status.isPremium);
    
    // Return new tokens
    res.json({
      token,
      refreshToken: newRefreshToken,
      expiresAt: expiration,
      isPremium: status.isPremium
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Sign out endpoint
app.post('/api/sign-out', verifyDynamicToken, (req, res) => {
  const token = req.headers['x-auth-token'] || req.headers['authorization']?.split(' ')[1];
  
  // Skip for static token
  if (token === AUTH_TOKEN) {
    return res.json({ success: true });
  }
  
  const tokenData = activeTokens.get(token);
  
  if (tokenData) {
    // Invalidate refresh token if exists
    if (tokenData.refreshToken) {
      activeTokens.delete(tokenData.refreshToken);
    }
    
    // Invalidate the token itself
    activeTokens.delete(token);
  }
  
  res.json({ success: true });
});

// Bootstrap token endpoint (for initial setup)
app.post('/api/bootstrap-token', (req, res) => {
  // In a real implementation, you would verify the request
  // based on extension ID, a shared secret, or other mechanism
  const { extensionId } = req.body;
  
  if (!extensionId) {
    return res.status(400).json({ error: 'Extension ID required' });
  }
  
  // Check if this is a known extension ID
  // This is a placeholder - you'd have a whitelist of valid extension IDs
  const validExtensionIds = [
    // Add your extension IDs here
  ];
  
  if (!validExtensionIds.includes(extensionId)) {
    return res.status(403).json({ error: 'Unknown extension' });
  }
  
  // Return the bootstrap token
  res.json({
    bootstrapToken: AUTH_TOKEN,
    expiresAt: Date.now() + (1 * 60 * 60 * 1000) // 1 hour
  });
});

// Chat endpoint (supports both JWT and token auth)
app.post('/api/chat', async (req, res) => {
  const { email, message } = req.body;
  
  if (!email || !message) {
    return res.status(400).json({ error: 'Email and message are required' });
  }
  
  // Check authentication (supports both methods)
  let isAuthenticated = false;
  let isPremium = false;
  
  // Method 1: JWT token
  const authHeader = req.headers.authorization || '';
  const jwtToken = authHeader.split(' ')[1];
  
  if (jwtToken) {
    try {
      const user = jwt.verify(jwtToken, JWT_SECRET);
      
      if (user.email !== email) {
        return res.status(403).json({
          error: 'Authentication error',
          reason: 'Token email mismatch'
        });
      }
      
      isAuthenticated = true;
      isPremium = user.isPremium;
    } catch (err) {
      // JWT token invalid, try next method
    }
  }
  
  // Method 2: Dynamic token
  if (!isAuthenticated) {
    const token = req.headers['x-auth-token'];
    
    if (token === AUTH_TOKEN) {
      // Static token grants full access
      isAuthenticated = true;
      isPremium = true;
    } else if (token) {
      const tokenData = activeTokens.get(token);
      
      if (tokenData && !tokenData.isRefreshToken && tokenData.expiration > Date.now()) {
        if (tokenData.email !== email) {
          return res.status(403).json({
            error: 'Authentication error',
            reason: 'Token email mismatch'
          });
        }
        
        isAuthenticated = true;
        isPremium = tokenData.isPremium;
      }
    }
  }
  
  if (!isAuthenticated) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const status = await checkUserPremiumStatus(email);
    
    if (!status.isInSheet) {
      return res.status(403).json({ error: 'Not a premium user', reason: 'User not found' });
    }
    
    if (!status.isPremium && isPremium) {
      // Update cached premium status if changed
      isPremium = false;
      
      // If using dynamic token, update the token data
      const token = req.headers['x-auth-token'];
      if (token && token !== AUTH_TOKEN) {
        const tokenData = activeTokens.get(token);
        if (tokenData) {
          tokenData.isPremium = false;
        }
      }
    }
    
    if (!isPremium) {
      return res.status(403).json({
        error: 'Subscription expired',
        reason: status.subscriptionData?.reason || 'No active subscription'
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
    res.status(500).json({ error: 'Server error', message: 'An internal error occurred' });
  }
});

// Add token verification middleware for ChatGPT endpoint
app.post('/api/chatgpt', async (req, res) => {
  // Get token from headers
  const token = req.headers['x-auth-token'] || req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  // Check if using static token
  if (token === AUTH_TOKEN) {
    // Allow static token for transition period
    // In a production environment, forward to ChatGPT API here
    return res.json({
      choices: [
        {
          message: {
            content: "This is a simulated ChatGPT API response using static token."
          }
        }
      ]
    });
  }
  
  // Verify dynamic token
  const tokenData = activeTokens.get(token);
  
  if (!tokenData) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  if (tokenData.expiration < Date.now()) {
    // Token expired
    activeTokens.delete(token);
    return res.status(401).json({ error: 'Token expired' });
  }
  
  // Check premium status for premium features
  if (req.body.isPremiumFeature && !tokenData.isPremium) {
    return res.status(403).json({ error: 'Premium subscription required' });
  }
  
  // Token is valid, forward to ChatGPT API
  // In a production environment, forward to actual ChatGPT API here
  res.json({
    choices: [
      {
        message: {
          content: "This is a simulated ChatGPT API response using dynamic token."
        }
      }
    ]
  });
});

// === Start server ===
app.listen(PORT, async () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
  await initializeSheetsClient();
});
