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
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

// Environment variables - all sensitive data should be in .env
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET; // Must be a strong, random value
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET; // Different from JWT_SECRET
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

// Validate required environment variables
if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  console.error('JWT secrets must be defined in environment variables');
  process.exit(1);
}

// Express setup with security middleware
const app = express();
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP as it might interfere with Chrome extension
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false
}));

// Strict CORS configuration
const allowedOrigins = [
  /^chrome-extension:\/\/.+$/,
  'https://solveoai.vercel.app'
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is allowed
    const allowed = allowedOrigins.some(pattern => {
      return typeof pattern === 'string' 
        ? pattern === origin 
        : pattern.test(origin);
    });
    
    if (allowed) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  methods: ['GET', 'POST'],
  credentials: true,
  maxAge: 86400 // 24 hours
}));

app.use(express.json({ limit: '10kb' })); // Limit JSON payload size

// Rate limiting configuration with different limits by endpoint
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit auth attempts
  message: 'Too many authentication attempts, please try again later'
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit regular API calls
  message: 'Too many requests from this IP, please try again later'
});

// Initialize Google OAuth2 client
const oauth2Client = new OAuth2Client({
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET
});

// JWT token functions (replacing the previous token store)
const tokenService = {
  // Generate new token
  generateAccessToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
  },
  
  // Generate refresh token (longer lived)
  generateRefreshToken(payload) {
    return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '7d' });
  },
  
  // Verify access token
  verifyAccessToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (error) {
      return null;
    }
  },
  
  // Verify refresh token
  verifyRefreshToken(token) {
    try {
      return jwt.verify(token, JWT_REFRESH_SECRET);
    } catch (error) {
      return null;
    }
  }
};

// Initialize Google Sheets
let sheetsClient = null;
let sheetTabName = null;

async function initSheetsClient() {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
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
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    
    const client = await auth.getClient();
    sheetsClient = google.sheets({ version: 'v4', auth: client });
    
    const meta = await sheetsClient.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
    sheetTabName = meta.data.sheets[0].properties.title;
    console.log(`✅ Sheets connected, using tab "${sheetTabName}"`);
  } catch (error) {
    console.error('Failed to initialize Google Sheets client:', error);
    // Continue without failing, but log the error
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
      range: `${sheetTabName}!A:G`
    });
    
    const rows = resp.data.values || [];
    if (rows.length < 2) return { isPremium: false, isInSheet: false };
    
    // Find header indexes
    const headers = rows[0].map(h => h.toLowerCase().trim());
    const emailIdx = headers.findIndex(h => h.includes('email'));
    const cancelIdx = headers.findIndex(h => h.includes('cancel'));
    const endIdx = headers.findIndex(h => h.includes('end date'));
    
    if ([emailIdx, cancelIdx, endIdx].some(i => i < 0)) {
      console.error('Required columns not found in sheet:', { headers });
      return { isPremium: false, isInSheet: false };
    }
    
    // Find user row
    const normalized = email.toLowerCase().trim();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[emailIdx]) continue;
      
      if (row[emailIdx].toLowerCase().trim() === normalized) {
        const isCancelled = (row[cancelIdx] || '').toLowerCase() === 'true';
        const endRaw = (row[endIdx] || '').trim() || null;
        
        let isPremium = false;
        if (endRaw) {
          // Subscription with end date
          isPremium = new Date(endRaw) >= new Date();
        } else {
          // Lifetime subscription
          isPremium = !isCancelled;
        }
        
        return {
          isPremium,
          isInSheet: true,
          daysRemaining: endRaw ? calculateDaysRemaining(endRaw) : null,
          endDate: endRaw
        };
      }
    }
    
    return { isPremium: false, isInSheet: false };
  } catch (error) {
    console.error('Error checking premium status:', error);
    return { isPremium: false, isInSheet: false, error: true };
  }
}

function calculateDaysRemaining(endDateStr) {
  const now = new Date();
  const end = new Date(endDateStr);
  if (isNaN(end)) return null;
  if (end < now) return 0;
  return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
}

// Auth middleware using JWT
function authenticate(req, res, next) {
  // Get token from Authorization header
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') 
    ? authHeader.split(' ')[1] 
    : null;
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // Verify token
  const payload = tokenService.verifyAccessToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  // Add user data to request
  req.user = {
    email: payload.email,
    isPremium: payload.isPremium,
    userId: payload.sub
  };
  
  next();
}

// Premium feature middleware
function requirePremium(req, res, next) {
  if (!req.user || !req.user.isPremium) {
    return res.status(403).json({ error: 'Premium subscription required' });
  }
  next();
}

// Verify Google token
async function verifyGoogleToken(token) {
  try {
    const ticket = await oauth2Client.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    
    // Verify the token was issued to our application
    if (payload.aud !== GOOGLE_CLIENT_ID) {
      console.error('Token was not issued for this application');
      return null;
    }
    
    return payload;
  } catch (error) {
    console.error('Google token verification failed:', error);
    return null;
  }
}

// Routes
app.get('/api/health', (_, res) => res.json({ status: 'OK' }));

// Authentication routes with rate limiting
app.post('/api/auth/token', authLimiter, async (req, res) => {
  const { googleToken } = req.body;
  
  if (!googleToken) {
    return res.status(400).json({ error: 'Google token required' });
  }
  
  try {
    // Verify Google token
    const payload = await verifyGoogleToken(googleToken);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }
    
    const email = payload.email;
    
    // Check user premium status
    const userStatus = await checkUserPremiumStatus(email);
    console.log('User premium status:', { email, ...userStatus });
    
    // Generate JWT tokens with user data
    const tokenPayload = {
      sub: payload.sub, // Google user ID as subject
      email: email,
      isPremium: userStatus.isPremium,
      name: payload.name
    };
    
    const accessToken = tokenService.generateAccessToken(tokenPayload);
    const refreshToken = tokenService.generateRefreshToken(tokenPayload);
    
    // Calculate token expiration (1 hour from now)
    const expiresAt = Date.now() + 60 * 60 * 1000;
    
    res.json({
      token: accessToken,
      refreshToken: refreshToken,
      expiresAt: expiresAt,
      isPremium: userStatus.isPremium,
      isInSheet: userStatus.isInSheet,
      email: email
    });
  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

app.post('/api/refresh-token', authLimiter, async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }
  
  try {
    // Verify refresh token
    const payload = tokenService.verifyRefreshToken(refreshToken);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
    
    // Check latest premium status
    const email = payload.email;
    const status = await checkUserPremiumStatus(email);
    
    if (!status.isInSheet) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Generate new tokens with updated premium status
    const tokenPayload = {
      sub: payload.sub,
      email: email,
      isPremium: status.isPremium,
      name: payload.name
    };
    
    const accessToken = tokenService.generateAccessToken(tokenPayload);
    const newRefreshToken = tokenService.generateRefreshToken(tokenPayload);
    
    // Calculate token expiration (1 hour from now)
    const expiresAt = Date.now() + 60 * 60 * 1000;
    
    res.json({
      token: accessToken,
      refreshToken: newRefreshToken,
      expiresAt: expiresAt,
      isPremium: status.isPremium,
      email: email
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// No need for explicit sign-out on server with JWT
// (tokens will expire automatically)

// Protected API routes with rate limiting
app.post('/api/chatgpt', apiLimiter, authenticate, requirePremium, async (req, res) => {
  try {
    // In production, forward to actual ChatGPT API here
    // Make sure to validate the input and sanitize responses
    
    // This is a simulated response
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
    console.error('ChatGPT API error:', error);
    res.status(500).json({ error: 'Failed to process your request' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  
  // Don't expose error details in production
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.status(500).json({ 
    error: isProduction ? 'Something went wrong' : err.message 
  });
});

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initSheetsClient();
});
