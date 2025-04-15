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

// Token validation
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
    req.user = { email: req.body.email, isPremium: false };
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

// Calculate days remaining in subscription
function calculateDaysRemaining(endDateStr) {
  if (!endDateStr) return null;
  
  const endDate = new Date(endDateStr);
  const now = new Date();
  
  // If end date is in the past, return 0
  if (endDate < now) return 0;
  
  // Calculate days difference
  const diffTime = endDate - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

// Check if user is premium by looking up in Google Sheet
async function checkUserPremiumStatus(email) {
  console.log(`Checking premium status for: ${email}`);
  
  if (!email) {
    return { 
      isPremium: false, 
      isInSheet: false,
      message: 'No email provided'
    };
  }
  
  try {
    // If sheets client isn't initialized, initialize it
    if (!sheetsClient || !SHEET_TAB_NAME) {
      const initialized = await initializeSheetsClient();
      if (!initialized) {
        console.log('Google Sheets client initialization failed, using fallback');
        return { 
          isPremium: false, 
          isInSheet: false,
          message: 'Failed to connect to database'
        };
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
      return { 
        isPremium: false, 
        isInSheet: false,
        message: 'No data in database'
      };
    }
    
    // Find the header row to get column indexes
    const headers = rows[0].map(header => header.toLowerCase().trim());
    
    const emailColumnIndex = headers.findIndex(h => h.includes('email'));
    const startDateColumnIndex = headers.findIndex(h => h.includes('start'));
    const endDateColumnIndex = headers.findIndex(h => h.includes('end'));
    const cancelledColumnIndex = headers.findIndex(h => h.includes('cancel'));
    
    if (emailColumnIndex === -1) {
      console.error('Email column not found in spreadsheet');
      return { 
        isPremium: false, 
        isInSheet: false,
        message: 'Database structure error'
      };
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
          
          // Make sure all data is properly extracted and logged for debugging
          const startDate = (startDateColumnIndex !== -1 && row[startDateColumnIndex]) || null;
          const endDate = (endDateColumnIndex !== -1 && row[endDateColumnIndex]) || null;
          const isCancelled = (cancelledColumnIndex !== -1 && row[cancelledColumnIndex]) 
            ? row[cancelledColumnIndex].toLowerCase() === 'true'
            : false;
          
          console.log(`DEBUG - Raw subscription details from sheet:`);
          console.log(`- Start Date: '${startDate}'`);
          console.log(`- End Date: '${endDate}'`);
          console.log(`- Cancelled: '${row[cancelledColumnIndex]}' (parsed as: ${isCancelled})`);
          
          // Calculate days remaining - only if we have a valid end date
          let daysRemaining = null;
          if (endDate && endDate.trim() !== '') {
            daysRemaining = calculateDaysRemaining(endDate);
            console.log(`- Days Remaining: ${daysRemaining}`);
          }
          
          // PREMIUM LOGIC:
          // User is premium if:
          // 1. They are in the sheet AND
          // 2. Either:
          //    a. End date hasn't passed (even if cancelled)
          //    b. No end date AND not cancelled (lifetime)
          let isPremium = false;
          let reason = '';
          
          const now = new Date();
          
          // If we have an end date, check if it's in the future
          if (endDate && endDate.trim() !== '') {
            try {
              const subscriptionEnd = new Date(endDate);
              console.log(`DEBUG - Date comparison: Current (${now.toISOString()}) vs End (${subscriptionEnd.toISOString()})`);
              
              if (subscriptionEnd >= now) {
                // End date is in the future - user is premium regardless of cancellation
                isPremium = true;
                reason = isCancelled ? 
                  `Premium until ${endDate} despite cancellation` : 
                  `Active subscription until ${endDate}`;
              } else {
                // End date has passed
                isPremium = false;
                reason = `Subscription expired on ${endDate}`;
              }
            } catch (dateError) {
              console.error(`Error parsing date: ${dateError}`);
              // Default to non-premium if date parsing fails
              isPremium = false;
              reason = `Error validating subscription date`;
            }
          } else {
            // No end date - lifetime subscription unless cancelled
            isPremium = !isCancelled;
            reason = isCancelled ? 
              'Lifetime subscription cancelled' : 
              'Lifetime subscription active';
          }
          
          return {
            isPremium,
            isInSheet: true,
            subscriptionData: {
              startDate,
              endDate,
              isCancelled,
              daysRemaining,
              reason
            }
          };
        }
      }
    }
    
    // User not found in sheet
    console.log(`User ${email} not found in premium sheet`);
    return { 
      isPremium: false, 
      isInSheet: false,
      message: 'User not found in database'
    };
    
  } catch (error) {
    console.error('Error checking user premium status:', error);
    return { 
      isPremium: false, 
      isInSheet: false,
      message: 'Server error checking status'
    };
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
    
    // Log detailed information about the verification
    console.log(`DEBUG - Verification results for ${email}:`);
    console.log(`- isPremium: ${userStatus.isPremium}`);
    console.log(`- isInSheet: ${userStatus.isInSheet}`);
    console.log(`- Reason: ${userStatus.subscriptionData?.reason || userStatus.message}`);
    if (userStatus.subscriptionData) {
      console.log(`- Days Remaining: ${userStatus.subscriptionData.daysRemaining}`);
    }
    
    // Build response object without token initially
    const responseObj = {
      email,
      isPremium: userStatus.isPremium,
      isInSheet: userStatus.isInSheet,
      subscriptionData: userStatus.subscriptionData,
      message: userStatus.message
    };
    
    // Only generate a JWT token if user is found in the sheet
    if (userStatus.isInSheet) {
      const token = jwt.sign(
        { 
          email, 
          isPremium: userStatus.isPremium,
          isInSheet: userStatus.isInSheet
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      // Add token to response only if user exists in sheet
      responseObj.token = token;
      console.log(`User ${email} found in sheet, premium status: ${userStatus.isPremium}`);
    } else {
      console.log(`User ${email} not found in sheet, no token generated`);
    }
    
    // Return user status (with token only if user exists)
    return res.json(responseObj);
    
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
    
    // Always verify with the database regardless of token
    // This ensures we have the latest premium status
    const userStatus = await checkUserPremiumStatus(email);
    
    // Verify the email in token matches the email in request
    if (req.user.email !== email) {
      console.log(`Token email (${req.user.email}) doesn't match request email (${email})`);
      return res.status(403).json({ 
        error: 'Authentication error',
        reason: 'Token email mismatch'
      });
    }
    
    // Verify user is in sheet and has premium status
    if (!userStatus.isInSheet) {
      console.log(`User not found in database: ${email}`);
      return res.status(403).json({ 
        error: 'Premium feature unavailable',
        reason: 'User not found in database'
      });
    }
    
    if (!userStatus.isPremium) {
      console.log(`Premium feature unavailable for user: ${email}`);
      return res.status(403).json({ 
        error: 'Premium feature unavailable',
        reason: userStatus.subscriptionData?.reason || 'Not a premium user'
      });
    }
    
    // Process chat message (simulated AI response)
    const aiResponse = `This is a simulated AI response to: "${message}"`;
    return res.json({ 
      response: aiResponse,
      subscriptionInfo: {
        endDate: userStatus.subscriptionData?.endDate,
        daysRemaining: userStatus.subscriptionData?.daysRemaining
      }
    });
    
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
  
  console.log('\nReady to handle requests');
});
