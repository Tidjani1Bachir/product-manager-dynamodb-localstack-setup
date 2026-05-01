// ============================================================
// db.js — DynamoDB via LocalStack Pro (Vercel-ready)
// ============================================================
// Install deps:
//   npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb

require('dotenv').config();

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { 
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand 
} = require('@aws-sdk/lib-dynamodb');

const {
  CreateTableCommand,
  DescribeTableCommand,
  ResourceInUseException,
} = require('@aws-sdk/client-dynamodb');

// ── 1. DynamoDB Client Configuration ──────────────────────────
// ✅ Uses LOCALSTACK_ENDPOINT for cloud access (Vercel-compatible)
const isLocalStack = !!process.env.LOCALSTACK_ENDPOINT;

const rawClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  
  // Only add endpoint/credentials if using LocalStack (dev or Pro cloud)
  ...(isLocalStack && {
    endpoint: process.env.LOCALSTACK_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
    },
    // Disable SSL verification for LocalStack dev (optional)
    tls: process.env.NODE_ENV === 'production' && !process.env.LOCALSTACK_ENDPOINT,
  }),
  
  // Reduce connection timeout for serverless
  maxAttempts: 3,
  retryMode: 'standard',
});

// ── 2. Document Client (use this in all routes) ───────────────
const db = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
  unmarshallOptions: { wrapNumbers: false },
});

// ── 3. Table Definitions (same schema as your SQLite) ─────────
const TABLE_DEFINITIONS = [
  {
    TableName: 'Products',
    KeySchema: [{ AttributeName: 'productId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'productId', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'Categories',
    KeySchema: [{ AttributeName: 'categoryId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'categoryId', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'StockHistory',
    KeySchema: [{ AttributeName: 'historyId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'historyId', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'AppSettings',
    KeySchema: [{ AttributeName: 'settingKey', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'settingKey', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
];

// ── 4. Safe Table Initialization (idempotent for serverless) ─
// ✅ Runs on startup but skips existing tables
// ✅ Safe for Vercel cold starts (no errors if table exists)
async function initDb() {
  // Skip table creation in production if using real AWS (no endpoint)
  if (!isLocalStack && process.env.NODE_ENV === 'production') {
    console.log('ℹ️  Using production DynamoDB (no table bootstrap needed)');
    return;
  }

  for (const def of TABLE_DEFINITIONS) {
    try {
      await rawClient.send(new CreateTableCommand(def));
      console.log(`✅ Table created: ${def.TableName}`);
    } catch (err) {
      // Table already exists — safe to ignore
      if (err.name === 'ResourceInUseException' || err.__type?.includes('ResourceInUseException')) {
        console.log(`ℹ️  Table already exists: ${def.TableName}`);
      } else {
        console.error(`❌ Failed to create table ${def.TableName}:`, err.message);
        // Don't crash the server — let routes handle missing table errors
      }
    }
  }
  console.log('✅ DynamoDB ready');
}

// Run initialization (safe to call multiple times)
initDb().catch((err) => {
  console.error('⚠️  DynamoDB init warning:', err.message);
  // Don't exit(1) in serverless — let the function handle errors per-request
});

// ── 5. Exports ────────────────────────────────────────────────
module.exports = {
  db,                 // Use this in every route
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
  TABLES: {
    PRODUCTS: 'Products',
    CATEGORIES: 'Categories',
    STOCK_HISTORY: 'StockHistory',
    APP_SETTINGS: 'AppSettings',
  },
};