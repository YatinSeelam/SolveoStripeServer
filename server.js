// // server.js - Secure token management and API endpoints
// const express = require('express');
// const cors = require('cors');
// const { google } = require('googleapis');
// const jwt = require('jsonwebtoken');
// const crypto = require('crypto');
// require('dotenv').config();

// // Environment variables
// const PORT = process.env.PORT || 3000;
// const JWT_SECRET = process.env.JWT_SECRET;
// const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// // Express setup
// const app = express();
// app.use(cors({
//   origin: [/^chrome-extension:\/\/.+$/, 'https://solveoai.vercel.app'],
//   methods: ['GET', 'POST'],
//   credentials: true
// }));
// app.use(express.json());

// // Secure token storage (use Redis in production)
// const tokenStore = {
//   tokens: new Map(),
  
//   // Generate new token
//   create(email, isPremium) {
//     const token = crypto.randomBytes(32).toString('hex');
//     const refreshToken = crypto.randomBytes(32).toString('hex');
//     const expiration = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
    
//     this.tokens.set(token, {
//       email, isPremium, refreshToken, expiration
//     });
    
//     this.tokens.set(refreshToken, {
//       email, isPremium, parentToken: token, isRefreshToken: true
//     });
    
//     return { token, refreshToken, expiration };
//   },
  
//   // Verify token
//   verify(token) {
//     const data = this.tokens.get(token);
//     if (!data) return null;
    
//     // Expired token
//     if (data.expiration && data.expiration < Date.now()) {
//       this.revoke(token);
//       return null;
//     }
    
//     return data;
//   },
  
//   // Refresh token
//   refresh(refreshToken, newPremiumStatus) {
//     const data = this.tokens.get(refreshToken);
//     if (!data || !data.isRefreshToken) return null;
    
//     // Revoke old tokens
//     if (data.parentToken) this.revoke(data.parentToken);
//     this.tokens.delete(refreshToken);
    
//     // Generate new tokens
//     return this.create(data.email, newPremiumStatus ?? data.isPremium);
//   },
  
//   // Revoke token
//   revoke(token) {
//     const data = this.tokens.get(token);
//     if (!data) return;
    
//     if (data.refreshToken) this.tokens.delete(data.refreshToken);
//     if (data.parentToken) this.tokens.delete(data.parentToken);
//     this.tokens.delete(token);
//   }
// };

// // Rate limiting middleware
// const rateLimiter = (() => {
//   const requests = new Map();
//   const limits = {
//     '/api/auth/token': { maxRequests: 5, windowMs: 60 * 1000 },
//     '/api/refresh-token': { maxRequests: 10, windowMs: 60 * 1000 },
//     'default': { maxRequests: 30, windowMs: 60 * 1000 }
//   };
  
//   return (req, res, next) => {
//     const ip = req.ip || req.headers['x-forwarded-for'];
//     const endpoint = req.path;
//     const key = `${ip}:${endpoint}`;
//     const now = Date.now();
//     const settings = limits[endpoint] || limits.default;
    
//     let record = requests.get(key);
//     if (!record) {
//       record = { count: 0, resetAt: now + settings.windowMs };
//       requests.set(key, record);
//     }
    
//     if (now > record.resetAt) {
//       record.count = 0;
//       record.resetAt = now + settings.windowMs;
//     }
    
//     if (record.count >= settings.maxRequests) {
//       return res.status(429).json({ error: 'Rate limit exceeded' });
//     }
    
//     record.count++;
//     next();
//   };
// })();

// // Initialize Google Sheets
// let sheetsClient = null;
// let sheetTabName = null;

// async function initSheetsClient() {
//   const auth = new google.auth.GoogleAuth({
//     credentials: {
//       type: process.env.SERVICE_ACCOUNT_TYPE,
//       project_id: process.env.SERVICE_ACCOUNT_PROJECT_ID,
//       private_key_id: process.env.SERVICE_ACCOUNT_PRIVATE_KEY_ID,
//       private_key: process.env.SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
//       client_email: process.env.SERVICE_ACCOUNT_CLIENT_EMAIL,
//       client_id: process.env.SERVICE_ACCOUNT_CLIENT_ID,
//       auth_uri: process.env.SERVICE_ACCOUNT_AUTH_URI,
//       token_uri: process.env.SERVICE_ACCOUNT_TOKEN_URI,
//       auth_provider_x509_cert_url: process.env.SERVICE_ACCOUNT_AUTH_PROVIDER_X509_CERT_URL,
//       client_x509_cert_url: process.env.SERVICE_ACCOUNT_CLIENT_X509_CERT_URL
//     },
//     scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
//   });
  
//   const client = await auth.getClient();
//   sheetsClient = google.sheets({ version: 'v4', auth: client });
  
//   const meta = await sheetsClient.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
//   sheetTabName = meta.data.sheets[0].properties.title;
//   console.log(`✅ Sheets connected, using tab "${sheetTabName}"`);
// }

// // Check user's premium status
// async function checkUserPremiumStatus(email) {
//   if (!email) return { isPremium: false, isInSheet: false };
//   if (!sheetsClient) await initSheetsClient();
  
//   const resp = await sheetsClient.spreadsheets.values.get({
//     spreadsheetId: GOOGLE_SHEET_ID,
//     range: `${sheetTabName}!A:G`
//   });
  
//   const rows = resp.data.values || [];
//   if (rows.length < 2) return { isPremium: false, isInSheet: false };
  
//   // Find header indexes
//   const headers = rows[0].map(h => h.toLowerCase().trim());
//   const emailIdx = headers.findIndex(h => h.includes('email'));
//   const cancelIdx = headers.findIndex(h => h.includes('cancel'));
//   const endIdx = headers.findIndex(h => h.includes('end date'));
  
//   if ([emailIdx, cancelIdx, endIdx].some(i => i < 0)) {
//     return { isPremium: false, isInSheet: false };
//   }
  
//   // Find user row
//   const normalized = email.toLowerCase().trim();
//   for (let i = 1; i < rows.length; i++) {
//     const row = rows[i];
//     if ((row[emailIdx] || '').toLowerCase().trim() === normalized) {
//       const isCancelled = (row[cancelIdx] || '').toLowerCase() === 'true';
//       const endRaw = (row[endIdx] || '').trim() || null;
      
//       let isPremium = false;
//       if (endRaw) {
//         // Subscription with end date
//         isPremium = new Date(endRaw) >= new Date();
//       } else {
//         // Lifetime subscription
//         isPremium = !isCancelled;
//       }
      
//       return {
//         isPremium,
//         isInSheet: true,
//         daysRemaining: endRaw ? calculateDaysRemaining(endRaw) : null,
//         endDate: endRaw
//       };
//     }
//   }
  
//   return { isPremium: false, isInSheet: false };
// }

// function calculateDaysRemaining(endDateStr) {
//   const now = new Date();
//   const end = new Date(endDateStr);
//   if (isNaN(end)) return null;
//   if (end < now) return 0;
//   return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
// }

// // Auth middleware
// function authenticate(req, res, next) {
//   const token = req.headers['x-auth-token'] || req.headers.authorization?.split(' ')[1];
  
//   if (!token) {
//     return res.status(401).json({ error: 'No token provided' });
//   }
  
//   const userData = tokenStore.verify(token);
//   if (!userData) {
//     return res.status(401).json({ error: 'Invalid or expired token' });
//   }
  
//   if (userData.isRefreshToken) {
//     return res.status(401).json({ error: 'Cannot use refresh token for API access' });
//   }
  
//   req.user = {
//     email: userData.email,
//     isPremium: userData.isPremium
//   };
  
//   next();
// }

// // Routes
// app.get('/api/test', (_, res) => res.json({ status: 'OK' }));

// app.post('/api/auth/token', rateLimiter, async (req, res) => {
//   const { email, googleToken } = req.body;
  
//   if (!email) {
//     return res.status(400).json({ error: 'Email required' });
//   }
  
//   try {
//     // Verify Google token (implement proper verification in production)
//     if (googleToken) {
//       // Verification would go here
//     }
    
//     // Check user premium status
//     const userStatus = await checkUserPremiumStatus(email);
    
//     // Generate secure token
//     const { token, refreshToken, expiration } = tokenStore.create(
//       email, 
//       userStatus.isPremium
//     );
    
//     res.json({
//       token,
//       refreshToken,
//       expiresAt: expiration,
//       isPremium: userStatus.isPremium,
//       isInSheet: userStatus.isInSheet
//     });
//   } catch (error) {
//     console.error('Token generation error:', error);
//     res.status(500).json({ error: 'Server error' });
//   }
// });

// app.post('/api/refresh-token', rateLimiter, async (req, res) => {
//   const { refreshToken, email } = req.body;
  
//   if (!refreshToken || !email) {
//     return res.status(400).json({ error: 'Refresh token and email required' });
//   }
  
//   try {
//     // Check latest premium status
//     const status = await checkUserPremiumStatus(email);
    
//     if (!status.isInSheet) {
//       return res.status(404).json({ error: 'User not found' });
//     }
    
//     // Generate new tokens with updated premium status
//     const tokens = tokenStore.refresh(refreshToken, status.isPremium);
    
//     if (!tokens) {
//       return res.status(401).json({ error: 'Invalid refresh token' });
//     }
    
//     res.json({
//       token: tokens.token,
//       refreshToken: tokens.refreshToken,
//       expiresAt: tokens.expiration,
//       isPremium: status.isPremium
//     });
//   } catch (error) {
//     console.error('Token refresh error:', error);
//     res.status(500).json({ error: 'Server error' });
//   }
// });

// app.post('/api/sign-out', authenticate, (req, res) => {
//   const token = req.headers['x-auth-token'] || req.headers.authorization?.split(' ')[1];
//   tokenStore.revoke(token);
//   res.json({ success: true });
// });

// app.post('/api/chatgpt', authenticate, async (req, res) => {
//   // Check premium status
//   if (!req.user.isPremium && req.body.isPremiumFeature) {
//     return res.status(403).json({ error: 'Premium subscription required' });
//   }
  
//   // Verify latest premium status from database
//   const status = await checkUserPremiumStatus(req.user.email);
  
//   if (!status.isInSheet) {
//     return res.status(403).json({ error: 'User not found' });
//   }
  
//   if (!status.isPremium) {
//     return res.status(403).json({ 
//       error: 'Subscription expired',
//       endDate: status.endDate
//     });
//   }
  
//   // In production, forward to actual ChatGPT API here
//   // This is a simulated response
//   res.json({
//     choices: [
//       {
//         message: {
//           content: "This is a secure ChatGPT API response."
//         }
//       }
//     ]
//   });
// });

// // Start server
// app.listen(PORT, async () => {
//   console.log(`Server running on port ${PORT}`);
//   await initSheetsClient();
// });
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
require('dotenv').config();

// Environment variables
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET; // Fallback to JWT_SECRET if refresh not set
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || 'Users!A2:F';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

// Legacy token for backward compatibility
const LEGACY_TOKEN = "mysecrettoken123"; // Keep this for backward compatibility

// Express setup
const app = express();
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for Chrome extension
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false
}));

// CORS configuration
app.use(cors({
  origin: [/^chrome-extension:\/\/.+$/, 'https://solveoai.vercel.app'],
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json({ limit: '10kb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
});
app.use(limiter);

// Initialize Google OAuth client if client ID is available
let oauth2Client = null;
if (GOOGLE_CLIENT_ID) {
  oauth2Client = new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET
  });
}

// Initialize Google Sheets
let sheetsClient = null;

async function initSheetsClient() {
  try {
    // Check if the Google credentials file exists
    if (!fs.existsSync(process.env.GOOGLE_KEY_FILE)) {
      console.error(`Google credentials file not found: ${process.env.GOOGLE_KEY_FILE}`);
      return;
    }

    // Load credentials from file
    const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_KEY_FILE, 'utf8'));
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    
    const client = await auth.getClient();
    sheetsClient = google.sheets({ version: 'v4', auth: client });
    
    console.log('✅ Google Sheets connected');
  } catch (error) {
    console.error('Failed to initialize Google Sheets client:', error);
  }
}

// Check user's premium status
async function checkUserPremiumStatus(email) {
  if (!email) return { isPremium: false, isInSheet: false };
  
  try {
    if (!sheetsClient) await initSheetsClient();
    
    // If sheets client still not available, return non-premium
    if (!sheetsClient) {
      console.error('Sheets client unavailable for premium check');
      return { isPremium: false, isInSheet: false, error: true };
    }
    
    const resp = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: GOOGLE_SHEET_RANGE
    });
    
    const rows = resp.data.values || [];
    if (rows.length === 0) return { isPremium: false, isInSheet: false };
    
    // Look for the email in the sheet
    // Assuming email is in the first column
    const normalized = email.toLowerCase().trim();
    
    for (const row of rows) {
      if (row.length === 0) continue;
      
      const rowEmail = (row[0] || '').toLowerCase().trim();
      if (rowEmail === normalized) {
        // Found the user, determine premium status
        // Assuming premium status is in the third column (if not, adjust this logic)
        const isPremium = row[2]?.toLowerCase() === 'true';
        
        return {
          isPremium,
          isInSheet: true
        };
      }
    }
    
    return { isPremium: false, isInSheet: false };
  } catch (error) {
    console.error('Error checking premium status:', error);
    return { isPremium: false, isInSheet: false, error: true };
  }
}

// JWT token functions
const tokenService = {
  // Generate access token
  generateAccessToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { 
      expiresIn: process.env.JWT_EXPIRY || '24h' 
    });
  },
  
  // Generate refresh token
  generateRefreshToken(payload) {
    return jwt.sign(payload, JWT_REFRESH_SECRET, { 
      expiresIn: '7d' 
    });
  }
};

// Authentication middleware (supports both legacy and JWT)
function authenticate(req, res, next) {
  // Get token from various header formats for compatibility
  const token = 
    req.headers['x-auth-token'] || 
    (req.headers.authorization?.startsWith('Bearer ') ? 
      req.headers.authorization.split(' ')[1] : 
      req.headers.authorization);
  
  // Special case for hardcoded token
  if (token === LEGACY_TOKEN) {
    req.user = { isLegacyToken: true };
    return next();
  }
  
  try {
    // Verify JWT token
    if (token) {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = {
        email: payload.email,
        isPremium: payload.isPremium
      };
      return next();
    }
  } catch (error) {
    // Token verification failed - continue to check other methods
  }
  
  return res.status(401).json({ error: 'Authentication required' });
}

// Verify Google token
async function verifyGoogleToken(token) {
  if (!token || !oauth2Client) return null;
  
  try {
    const ticket = await oauth2Client.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID
    });
    
    return ticket.getPayload();
  } catch (error) {
    console.error('Google token verification failed:', error);
    return null;
  }
}

// Routes
app.get('/api/health', (_, res) => res.json({ status: 'OK' }));

// Authentication endpoint - ensure this matches what your extension expects
app.post('/api/auth/token', async (req, res) => {
  const { email, googleToken } = req.body;
  
  console.log('Received auth request:', { email, hasGoogleToken: !!googleToken });
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }
  
  try {
    // Verify Google token if provided
    let verifiedEmail = email;
    
    if (googleToken && oauth2Client) {
      const payload = await verifyGoogleToken(googleToken);
      if (payload && payload.email) {
        verifiedEmail = payload.email;
        console.log('Google token verified for:', verifiedEmail);
      }
    }
    
    // Check if the user has premium
    const userStatus = await checkUserPremiumStatus(verifiedEmail);
    console.log('User status:', { email: verifiedEmail, ...userStatus });
    
    // Current timestamp + 24 hours (or JWT_EXPIRY)
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
    
    // Create JWT token for future use
    const jwtToken = tokenService.generateAccessToken({
      email: verifiedEmail,
      isPremium: userStatus.isPremium
    });
    
    const refreshToken = tokenService.generateRefreshToken({
      email: verifiedEmail
    });
    
    // For backward compatibility, use a generated token as well
    const token = Math.random().toString(36).substring(2) + 
                  Math.random().toString(36).substring(2);
    
    // Return both token types for compatibility
    res.json({
      token,
      refreshToken,
      expiresAt,
      isPremium: userStatus.isPremium,
      isInSheet: userStatus.isInSheet,
      email: verifiedEmail,
      // Add JWT tokens for future use
      jwtToken,
      jwtRefreshToken: refreshToken
    });
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Token refresh endpoint
app.post('/api/refresh-token', async (req, res) => {
  const { refreshToken, email } = req.body;
  
  if (!refreshToken || !email) {
    return res.status(400).json({ error: 'Refresh token and email required' });
  }
  
  try {
    // Check latest user status
    const status = await checkUserPremiumStatus(email);
    
    // Generate new tokens - both legacy and JWT
    const newToken = Math.random().toString(36).substring(2) + 
                     Math.random().toString(36).substring(2);
    const newRefreshToken = Math.random().toString(36).substring(2) + 
                            Math.random().toString(36).substring(2);
    
    // JWT tokens
    const jwtToken = tokenService.generateAccessToken({
      email,
      isPremium: status.isPremium
    });
    
    const jwtRefreshToken = tokenService.generateRefreshToken({ email });
    
    // Calculate token expiration (24 hours from now)
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
    
    res.json({
      token: newToken,
      refreshToken: newRefreshToken,
      expiresAt,
      isPremium: status.isPremium,
      email,
      // Include JWT tokens
      jwtToken,
      jwtRefreshToken
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// Dummy sign-out endpoint
app.post('/api/sign-out', (req, res) => {
  res.json({ success: true });
});

// ChatGPT API endpoint - supports both authentication methods
app.post('/api/chatgpt', authenticate, async (req, res) => {
  try {
    // For legacy token, check email from request
    if (req.user.isLegacyToken) {
      const email = req.body.email || req.body.messages?.[0]?.email;
      
      if (email) {
        // Check premium status for legacy token
        const status = await checkUserPremiumStatus(email);
        req.user = {
          email,
          isPremium: status.isPremium
        };
      }
    }
    
    // Check premium status if feature requires it
    if (!req.user.isPremium && req.body.isPremiumFeature) {
      return res.status(403).json({ error: 'Premium subscription required' });
    }
    
    // Simulate ChatGPT response
    // In production, this would forward to OpenAI/Azure
    res.json({
      choices: [
        {
          message: {
            content: "This is a secure ChatGPT API response."
          }
        }
      ]
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Failed to process your request' });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initSheetsClient();
});
