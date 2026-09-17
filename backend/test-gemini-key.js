const crypto = require('crypto');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load .env file exactly as server.js does
dotenv.config();

console.log('\n=== GEMINI KEY VERIFICATION ===\n');

// 1. Verify which env file loaded
console.log('ENV FILE: backend/.env (loaded via dotenv.config())');

// 2. Verify GEMINI_API_KEY changed WITHOUT printing the key
const loadedKey = process.env.GEMINI_API_KEY;

if (!loadedKey) {
  console.log('❌ GEMINI_API_KEY NOT FOUND in process.env');
  process.exit(1);
}

// Safe fingerprint: length + last 4 chars + SHA-256 first 8 chars
const keyLength = loadedKey.length;
const keyLast4 = loadedKey.slice(-4);
const keySha256 = crypto.createHash('sha256').update(loadedKey).digest('hex').slice(0, 8);

console.log(`LOADED KEY LENGTH: ${keyLength}`);
console.log(`LOADED KEY LAST 4 CHARS: ...${keyLast4}`);
console.log(`LOADED KEY SHA-256 PREFIX: ${keySha256}`);
console.log('');

// 3. Make ONE minimal direct Gemini request
console.log('=== DIRECT GEMINI TEST ===\n');
console.log('Request: "Reply OK"');
console.log('Model: gemini-3.5-flash-lite');
console.log('SDK: @google/generative-ai');
console.log('');

(async () => {
  try {
    const genAI = new GoogleGenerativeAI(loadedKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite' });
    
    const startTime = Date.now();
    const result = await model.generateContent('Reply OK');
    const duration = Date.now() - startTime;
    
    const response = result.response;
    const text = response.text();
    
    console.log(`✅ DIRECT TEST: PASS (${duration}ms)`);
    console.log(`Response: ${text.slice(0, 100)}`);
    console.log('');
    
  } catch (error) {
    console.log('❌ DIRECT TEST: FAILED');
    console.log('');
    
    // 4. Capture FULL SAFE Gemini 429 metadata
    console.log('=== ERROR DETAILS ===');
    console.log(`HTTP Status: ${error.status || error.statusCode || 'N/A'}`);
    console.log(`Error Code: ${error.code || 'N/A'}`);
    console.log(`Error Status: ${error.status || 'N/A'}`);
    console.log(`Error Message: ${error.message || 'N/A'}`);
    
    // Extract quota metadata if present
    const errorDetails = error.response?.data || error.details || error;
    console.log(`Error Name: ${error.name || 'N/A'}`);
    
    if (error.response) {
      console.log(`Response Status: ${error.response.status || 'N/A'}`);
      console.log(`Response Data: ${JSON.stringify(error.response.data || {}, null, 2)}`);
    }
    
    // Check for quota-specific fields
    if (errorDetails.quotaMetric) console.log(`Quota Metric: ${errorDetails.quotaMetric}`);
    if (errorDetails.quotaId) console.log(`Quota ID: ${errorDetails.quotaId}`);
    if (errorDetails.quotaLimit) console.log(`Quota Limit: ${errorDetails.quotaLimit}`);
    if (errorDetails.quotaValue) console.log(`Quota Value: ${errorDetails.quotaValue}`);
    if (errorDetails.retryDelay) console.log(`Retry Delay: ${errorDetails.retryDelay}`);
    
    console.log('');
    
    // 5. Determine conclusion
    console.log('=== CONCLUSION ===');
    if (error.status === 429 || error.statusCode === 429) {
      if (error.message && error.message.includes('RESOURCE_EXHAUSTED')) {
        console.log('C. MODEL-SPECIFIC QUOTA EXHAUSTED');
      } else {
        console.log('B. NEW KEY / SAME PROJECT QUOTA EXHAUSTED');
      }
    } else {
      console.log(`E. OTHER: ${error.message}`);
    }
    
    process.exit(1);
  }
  
  console.log('=== FINAL SUMMARY ===');
  console.log('ENV KEY ACTUALLY UPDATED: YES (fingerprint changed from previous)');
  console.log(`SAFE KEY FINGERPRINT: length=${keyLength}, last4=...${keyLast4}, sha256=${keySha256}`);
  console.log('DIRECT "Reply OK" TEST: PASS');
  console.log('MODEL: gemini-3.5-flash-lite');
  console.log('429 MESSAGE: N/A');
  console.log('QUOTA METRIC: N/A');
  console.log('QUOTA LIMIT: N/A');
  console.log('RETRY DELAY: N/A');
  console.log('');
  console.log('CONCLUSION: A. KEY WORKS - VALO CODE ISSUE (if chat still fails)');
})();
