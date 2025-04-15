// const express = require('express');
// const cors = require('cors');
// const { google } = require('googleapis');
// const fetch = require('node-fetch');
// const jwt = require('jsonwebtoken');
// const fs = require('fs');
// const path = require('path');

// // Load .env
// require('dotenv').config();

// // AI Assistant Extension Backend Server with Google Sheets Integration

// // Initialize Express app
// const app = express();
// app.use(cors({
//   origin: ['chrome-extension://*', 'http://localhost:3000'],
//   methods: ['GET', 'POST'],
//   credentials: true
// }));
// app.use(express.json());

// // Configuration
// const PORT = process.env.PORT || 3000;
// const JWT_SECRET = process.env.JWT_SECRET;
// const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID; 
// // We'll determine the sheet name dynamically
// let SHEET_TAB_NAME = null;

// // Helper: Build the service account object from environment variables
// function getServiceAccountCredentials() {
//   return {
//     type: process.env.SERVICE_ACCOUNT_TYPE,
//     project_id: process.env.SERVICE_ACCOUNT_PROJECT_ID,
//     private_key_id: process.env.SERVICE_ACCOUNT_PRIVATE_KEY_ID,
//     // convert the \n in the ENV var to real newlines
//     private_key: process.env.SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
//     client_email: process.env.SERVICE_ACCOUNT_CLIENT_EMAIL,
//     client_id: process.env.SERVICE_ACCOUNT_CLIENT_ID,
//     auth_uri: process.env.SERVICE_ACCOUNT_AUTH_URI,
//     token_uri: process.env.SERVICE_ACCOUNT_TOKEN_URI,
//     auth_provider_x509_cert_url: process.env.SERVICE_ACCOUNT_AUTH_PROVIDER_X509_CERT_URL,
//     client_x509_cert_url: process.env.SERVICE_ACCOUNT_CLIENT_X509_CERT_URL
//   };
// }

// // Initialize JWT middleware
// function authenticateToken(req, res, next) {
//   console.log('Authenticating request...');
  
//   // Get token from Authorization header
//   const authHeader = req.headers['authorization'];
//   const token = authHeader && authHeader.split(' ')[1];
  
//   if (!token) {
//     console.log('No token provided');
//     return res.status(401).json({ error: 'Unauthorized: No token provided' });
//   }
  
//   // Log token length for debugging
//   console.log(`Token length: ${token.length}`);
  
//   // Verify if it's a Google token or our JWT token
//   if (token.length > 1000) {
//     console.log('Processing as Google token');
//     // This is likely a Google token, verify with Google
//     verifyGoogleToken(token)
//       .then(payload => {
//         console.log('Google token verified successfully');
//         req.user = { email: payload.email };
//         next();
//       })
//       .catch(err => {
//         console.error('Google token verification error:', err);
//         return res.status(403).json({ error: 'Invalid Google token' });
//       });
//   } else {
//     console.log('Processing as JWT token');
//     // This is our JWT token
//     jwt.verify(token, JWT_SECRET, (err, user) => {
//       if (err) {
//         console.error('JWT verification error:', err);
//         return res.status(403).json({ error: 'Invalid token' });
//       }
//       req.user = user;
//       next();
//     });
//   }
// }

// // Verify Google token
// async function verifyGoogleToken(token) {
//   console.log('Verifying Google token...');
//   try {
//     const response = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`);
//     if (!response.ok) {
//       throw new Error(`Google token verification failed: ${response.status}`);
//     }
    
//     console.log('Token info verified');
    
//     // Get user info
//     const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
//       headers: { 'Authorization': `Bearer ${token}` }
//     });
    
//     if (!userInfoResponse.ok) {
//       throw new Error('Failed to get user info');
//     }
    
//     const userInfo = await userInfoResponse.json();
//     console.log('Retrieved user info for:', userInfo.email);
    
//     return userInfo;
//   } catch (error) {
//     console.error('Google token verification error:', error);
//     throw error;
//   }
// }

// // Initialize Google Sheets API client
// let sheetsClient = null;

// // Function to get the first sheet name in the spreadsheet
// async function getFirstSheetName() {
//   if (!sheetsClient) {
//     await initializeSheetsClient();
//   }
  
//   try {
//     const spreadsheet = await sheetsClient.spreadsheets.get({
//       spreadsheetId: GOOGLE_SHEET_ID
//     });
//     const firstSheet = spreadsheet.data.sheets[0];
//     return firstSheet.properties.title;
//   } catch (error) {
//     console.error('Error getting sheet name:', error);
//     throw error;
//   }
// }

// // Try to initialize Google Sheets client (wrapped in a function for retry capability)
// async function initializeSheetsClient() {
//   console.log('Initializing Google Sheets client...');
  
//   try {
//     // Construct credentials from environment variables
//     const credentials = getServiceAccountCredentials();
    
//     // Use them in GoogleAuth
//     const auth = new google.auth.GoogleAuth({
//       credentials,
//       scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
//     });
    
//     const authClient = await auth.getClient();
//     sheetsClient = google.sheets({ version: 'v4', auth: authClient });
    
//     console.log('Google Sheets API client initialized successfully');
    
//     // Test the connection
//     const test = await sheetsClient.spreadsheets.get({
//       spreadsheetId: GOOGLE_SHEET_ID
//     });
    
//     console.log(`Connected to Google Sheet: ${test.data.properties.title}`);
    
//     // Set sheet tab name
//     SHEET_TAB_NAME = test.data.sheets[0].properties.title;
//     console.log(`Using sheet tab: ${SHEET_TAB_NAME}`);
    
//     return true;
    
//   } catch (error) {
//     console.error('Error initializing Google Sheets client:', error);
//     return false;
//   }
// }

// // Fallback premium user check function (when Google Sheets is not available)
// function checkUserPremiumStatusFallback(email) {
//   console.log(`[FALLBACK] Checking premium status for: ${email}`);
  
//   // You can add known premium users here for testing
//   const premiumEmails = [
//     'youremail@gmail.com'
//   ];
  
//   const isPremium = premiumEmails.includes(email.toLowerCase());
  
//   return {
//     isPremium,
//     subscriptionData: isPremium ? {
//       startDate: '2025-01-01',
//       endDate: '2025-12-31',
//       isCancelled: false
//     } : null
//   };
// }

// // Check if user is premium by looking up email in Google Sheet
// async function checkUserPremiumStatus(email) {
//   console.log(`Checking premium status for: ${email}`);
  
//   try {
//     // If sheets client isn't initialized or sheet name isn't set, initialize
//     if (!sheetsClient || !SHEET_TAB_NAME) {
//       const initialized = await initializeSheetsClient();
//       if (!initialized) {
//         console.log('Using fallback premium user check');
//         return checkUserPremiumStatusFallback(email);
//       }
//     }
    
//     // Range to fetch (adjust based on your sheet structure)
//     const range = `${SHEET_TAB_NAME}!A:F`;
//     console.log(`Fetching data from sheet range: ${range}`);
    
//     // Fetch sheet data
//     const response = await sheetsClient.spreadsheets.values.get({
//       spreadsheetId: GOOGLE_SHEET_ID,
//       range
//     });
    
//     const rows = response.data.values;
//     if (!rows || rows.length === 0) {
//       console.log('No data found in sheet');
//       return { isPremium: false };
//     }
    
//     console.log(`Sheet data retrieved. Found ${rows.length} rows`);
    
//     // Find the header row to get column indexes
//     const headers = rows[0].map(header => header.toLowerCase().trim());
//     console.log('Headers:', headers);
    
//     const emailColumnIndex = headers.findIndex(h => h.includes('email'));
//     const startDateColumnIndex = headers.findIndex(h => h.includes('start'));
//     const endDateColumnIndex = headers.findIndex(h => h.includes('end'));
//     const cancelledColumnIndex = headers.findIndex(h => h.includes('cancel'));
    
//     if (emailColumnIndex === -1) {
//       console.error('Email column not found in spreadsheet');
//       return { isPremium: false };
//     }
    
//     console.log(`Email column found at index ${emailColumnIndex}`);
    
//     // Look for user email
//     const normalizedEmail = email.toLowerCase().trim();
//     for (let i = 1; i < rows.length; i++) {
//       const row = rows[i];
//       if (row.length > emailColumnIndex && row[emailColumnIndex]) {
//         const sheetEmail = row[emailColumnIndex].toLowerCase().trim();
//         if (sheetEmail === normalizedEmail) {
//           // Found the user
//           console.log(`Found user ${email} in sheet at row ${i + 1}`);
          
//           const startDate = (startDateColumnIndex !== -1 && row[startDateColumnIndex]) || null;
//           const endDate = (endDateColumnIndex !== -1 && row[endDateColumnIndex]) || null;
//           const isCancelled = (cancelledColumnIndex !== -1 && row[cancelledColumnIndex]) 
//             ? row[cancelledColumnIndex].toLowerCase() === 'true'
//             : false;
          
//           console.log(`Subscription dates: ${startDate} to ${endDate} (Cancelled: ${isCancelled})`);
          
//           let isPremium = true;
//           if (endDate) {
//             const now = new Date();
//             const subscriptionEnd = new Date(endDate);
//             if (subscriptionEnd < now) {
//               console.log('Subscription has expired');
//               isPremium = false;
//             }
//           }
          
//           return {
//             isPremium,
//             subscriptionData: {
//               startDate,
//               endDate,
//               isCancelled
//             }
//           };
//         }
//       }
//     }
    
//     // User not found in sheet
//     console.log(`User ${email} not found in premium sheet`);
//     return { isPremium: false };
    
//   } catch (error) {
//     console.error('Error checking user premium status:', error);
//     console.log('Using fallback due to error');
//     return checkUserPremiumStatusFallback(email);
//   }
// }

// // API Routes

// // Simple test route
// app.get('/api/test', (req, res) => {
//   res.json({ status: 'Server is running' });
// });

// // Verify user and check premium status
// app.post('/api/verify-user', authenticateToken, async (req, res) => {
//   try {
//     const email = req.body.email || req.user.email;
    
//     if (!email) {
//       return res.status(400).json({ error: 'Email is required' });
//     }
    
//     console.log(`Verifying premium status for user: ${email}`);
    
//     // Check user premium status in Google Sheet
//     const userStatus = await checkUserPremiumStatus(email);
    
//     // Generate a JWT token for future requests
//     const token = jwt.sign(
//       { email, isPremium: userStatus.isPremium },
//       JWT_SECRET,
//       { expiresIn: '1h' }
//     );
    
//     console.log(`User ${email} premium status: ${userStatus.isPremium}`);
    
//     // Return user status and new token
//     return res.json({
//       email,
//       isPremium: userStatus.isPremium,
//       subscriptionData: userStatus.subscriptionData,
//       token
//     });
    
//   } catch (error) {
//     console.error('Error in verify-user endpoint:', error);
//     return res.status(500).json({ error: 'Server error', message: error.message });
//   }
// });

// // Chat API (premium feature)
// app.post('/api/chat', authenticateToken, async (req, res) => {
//   try {
//     const { email, message } = req.body;
    
//     if (!email || !message) {
//       return res.status(400).json({ error: 'Email and message are required' });
//     }
    
//     console.log(`Chat request from ${email}: "${message}"`);
    
//     // Verify premium status
//     const userStatus = await checkUserPremiumStatus(email);
//     if (!userStatus.isPremium) {
//       console.log(`Premium feature unavailable for user: ${email}`);
//       return res.status(403).json({ error: 'Premium feature unavailable' });
//     }
    
//     // Process chat message (simulated AI response)
//     const aiResponse = `This is a simulated AI response to: "${message}"`;
//     return res.json({ response: aiResponse });
    
//   } catch (error) {
//     console.error('Error in chat endpoint:', error);
//     return res.status(500).json({ error: 'Server error', message: error.message });
//   }
// });

// // Admin endpoint to list all users (FOR TESTING ONLY - remove in production)
// app.get('/api/admin/list-users', async (req, res) => {
//   try {
//     if (!sheetsClient || !SHEET_TAB_NAME) {
//       const initialized = await initializeSheetsClient();
//       if (!initialized) {
//         return res.status(500).json({ error: 'Google Sheets client not initialized' });
//       }
//     }
    
//     // Fetch sheet data
//     const response = await sheetsClient.spreadsheets.values.get({
//       spreadsheetId: GOOGLE_SHEET_ID,
//       range: `${SHEET_TAB_NAME}!A:F`
//     });
    
//     const rows = response.data.values;
//     if (!rows || rows.length === 0) {
//       return res.json({ users: [] });
//     }
    
//     // Get header row
//     const headers = rows[0].map(header => header.toLowerCase().trim());
//     const emailColumnIndex = headers.findIndex(h => h.includes('email'));
//     const startDateColumnIndex = headers.findIndex(h => h.includes('start'));
//     const endDateColumnIndex = headers.findIndex(h => h.includes('end'));
//     const cancelledColumnIndex = headers.findIndex(h => h.includes('cancel'));
    
//     // Extract users
//     const users = [];
//     for (let i = 1; i < rows.length; i++) {
//       const row = rows[i];
//       if (row.length > emailColumnIndex && row[emailColumnIndex]) {
//         users.push({
//           email: row[emailColumnIndex],
//           startDate: (startDateColumnIndex !== -1 && row[startDateColumnIndex]) || null,
//           endDate: (endDateColumnIndex !== -1 && row[endDateColumnIndex]) || null,
//           cancelled: (cancelledColumnIndex !== -1 && row[cancelledColumnIndex])
//             ? row[cancelledColumnIndex].toLowerCase() === 'true'
//             : false
//         });
//       }
//     }
    
//     return res.json({ users });
    
//   } catch (error) {
//     console.error('Error listing users:', error);
//     return res.status(500).json({ error: 'Server error', message: error.message });
//   }
// });

// // Start the server
// app.listen(PORT, async () => {
//   console.log(`=== Solveo Payment Server ===`);
//   console.log(`Server running on port ${PORT}`);
  
//   // Initialize Google Sheets client on startup
//   await initializeSheetsClient();
  
//   console.log('\nAPI ENDPOINTS:');
//   console.log(`- Test: http://localhost:${PORT}/api/test`);
//   console.log(`- Verify User: http://localhost:${PORT}/api/verify-user`);
//   console.log(`- Chat: http://localhost:${PORT}/api/chat`);
//   console.log(`- Admin: http://localhost:${PORT}/api/admin/list-users (testing only)`);
//   console.log('\nReady to handle requests');
// });
// Final server implementation
// Final server implementation
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Initialize Express app
const app = express();

// CORS configuration
app.use(cors({
  origin: ['chrome-extension://*', 'http://localhost:3000', '*'],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));

app.use(express.json());

// Configuration from .env file
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
let SHEET_TAB_NAME = null;

console.log('Starting server with configuration:');
console.log(`- PORT: ${PORT}`);
console.log(`- JWT_SECRET: ${JWT_SECRET ? "Configured" : "Missing"}`);
console.log(`- GOOGLE_SHEET_ID: ${GOOGLE_SHEET_ID}`);

// Helper: Build the service account object from environment variables
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

// Basic token validation
function authenticateToken(req, res, next) {
  // Get token from Authorization header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  // For development: Allow token bypass with query param
  if (req.query.dev === 'true') {
    console.log('⚠️ Development mode: authentication bypassed');
    req.user = { 
      email: req.body.email || req.query.email || 'dev@example.com',
      isPremium: true
    };
    return next();
  }
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  // Very long tokens are likely Google tokens, not our JWT
  if (token.length > 1000) {
    // For development, just accept Google tokens
    req.user = { email: req.body.email, isPremium: true };
    return next();
  } else {
    // This is our JWT token
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        console.error('JWT verification error:', err);
        return res.status(403).json({ error: 'Invalid token' });
      }
      
      req.user = user;
      next();
    });
  }
}

// Initialize Google Sheets API client
let sheetsClient = null;

// Initialize Google Sheets client
async function initializeSheetsClient() {
  console.log('Initializing Google Sheets client...');
  
  try {
    // Construct credentials from environment variables
    const credentials = getServiceAccountCredentials();
    
    // Use them in GoogleAuth
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    
    const authClient = await auth.getClient();
    sheetsClient = google.sheets({ version: 'v4', auth: authClient });
    
    console.log('Google Sheets API client initialized successfully');
    
    // Test the connection
    const test = await sheetsClient.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID
    });
    
    console.log(`Connected to Google Sheet: ${test.data.properties.title}`);
    
    // Set sheet tab name
    SHEET_TAB_NAME = test.data.sheets[0].properties.title;
    console.log(`Using sheet tab: ${SHEET_TAB_NAME}`);
    
    return true;
    
  } catch (error) {
    console.error('Error initializing Google Sheets client:', error);
    console.error('Check your service account credentials in .env file');
    return false;
  }
}

// Check if user is premium by looking up in Google Sheet
async function checkUserPremiumStatus(email) {
  console.log(`Checking premium status for: ${email}`);
  
  if (!email) {
    return { isPremium: false };
  }
  
  try {
    // If sheets client isn't initialized, initialize it
    if (!sheetsClient || !SHEET_TAB_NAME) {
      const initialized = await initializeSheetsClient();
      if (!initialized) {
        console.log('Google Sheets client initialization failed, using fallback');
        return { isPremium: false };
      }
    }
    
    // Fetch sheet data
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TAB_NAME}!A:F`
    });
    
    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log('No data found in sheet');
      return { isPremium: false };
    }
    
    // Find the header row to get column indexes
    const headers = rows[0].map(header => header.toLowerCase().trim());
    
    const emailColumnIndex = headers.findIndex(h => h.includes('email'));
    const startDateColumnIndex = headers.findIndex(h => h.includes('start'));
    const endDateColumnIndex = headers.findIndex(h => h.includes('end'));
    const cancelledColumnIndex = headers.findIndex(h => h.includes('cancel'));
    
    if (emailColumnIndex === -1) {
      console.error('Email column not found in spreadsheet');
      return { isPremium: false };
    }
    
    // Look for user email
    const normalizedEmail = email.toLowerCase().trim();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length > emailColumnIndex && row[emailColumnIndex]) {
        const sheetEmail = row[emailColumnIndex].toLowerCase().trim();
        if (sheetEmail === normalizedEmail) {
          // Found the user
          console.log(`Found user ${email} in sheet at row ${i + 1}`);
          
          const startDate = (startDateColumnIndex !== -1 && row[startDateColumnIndex]) || null;
          const endDate = (endDateColumnIndex !== -1 && row[endDateColumnIndex]) || null;
          const isCancelled = (cancelledColumnIndex !== -1 && row[cancelledColumnIndex]) 
            ? row[cancelledColumnIndex].toLowerCase() === 'true'
            : false;
          
          console.log(`Subscription details: Started ${startDate}, Ends ${endDate || 'Never'}, Cancelled: ${isCancelled}`);
          
          // Default to false and only set to true if all conditions are met
          let isPremium = false;
          
          // Check if subscription has not expired
          if (endDate) {
            const now = new Date();
            const subscriptionEnd = new Date(endDate);
            
            // User is premium only if their subscription hasn't expired AND they haven't cancelled
            if (subscriptionEnd >= now && !isCancelled) {
              isPremium = true;
            } else {
              console.log('Subscription has expired or is cancelled');
            }
          } else if (!isCancelled) {
            // No end date (perhaps lifetime subscription) and not cancelled
            isPremium = true;
          }
          
          return {
            isPremium,
            subscriptionData: {
              startDate,
              endDate,
              isCancelled
            }
          };
        }
      }
    }
    
    // User not found in sheet
    console.log(`User ${email} not found in premium sheet`);
    return { isPremium: false };
    
  } catch (error) {
    console.error('Error checking user premium status:', error);
    return { isPremium: false };
  }
}

// API ROUTES

// Simple test route
app.get('/api/test', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Verify user and check premium status
app.post('/api/verify-user', async (req, res) => {
  try {
    const email = req.body.email;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    console.log(`Verifying premium status for user: ${email}`);
    
    // Check user premium status in Google Sheet
    const userStatus = await checkUserPremiumStatus(email);
    
    // Generate a JWT token for future requests
    const token = jwt.sign(
      { email, isPremium: userStatus.isPremium },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    console.log(`User ${email} premium status: ${userStatus.isPremium}`);
    
    // Return user status and new token
    return res.json({
      email,
      isPremium: userStatus.isPremium,
      subscriptionData: userStatus.subscriptionData,
      token
    });
    
  } catch (error) {
    console.error('Error in verify-user endpoint:', error);
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
});

// Chat API (premium feature)
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { email, message } = req.body;
    
    if (!email || !message) {
      return res.status(400).json({ error: 'Email and message are required' });
    }
    
    console.log(`Chat request from ${email}: "${message}"`);
    
    // Check premium status from token
    if (!req.user.isPremium) {
      // Double check with database for absolute verification
      const userStatus = await checkUserPremiumStatus(email);
      if (!userStatus.isPremium) {
        console.log(`Premium feature unavailable for user: ${email}`);
        return res.status(403).json({ error: 'Premium feature unavailable' });
      }
    }
    
    // Process chat message (simulated AI response)
    const aiResponse = `This is a simulated AI response to: "${message}"`;
    return res.json({ response: aiResponse });
    
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
});

// Start the server
app.listen(PORT, async () => {
  console.log(`=== Solveo Payment Server ===`);
  console.log(`Server running on port ${PORT}`);
  console.log(`Local URL: http://localhost:${PORT}`);
  
  // Initialize Google Sheets client on startup
  await initializeSheetsClient();
  
  console.log('\nAPI ENDPOINTS:');
  console.log(`- Test: http://localhost:${PORT}/api/test`);
  console.log(`- Verify User: http://localhost:${PORT}/api/verify-user`);
  console.log(`- Chat: http://localhost:${PORT}/api/chat (Protected, Premium)`);
  console.log(`- List Users: http://localhost:${PORT}/api/list-users (DEVELOPMENT ONLY)`);
  
  console.log('\nReady to handle requests');
});
