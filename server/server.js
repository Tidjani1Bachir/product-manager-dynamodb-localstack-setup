// ============================================================
// server.js — DynamoDB + LocalStack + CommonJS + Vercel-ready
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const PdfPrinter = require('pdfmake');

// ✅ Import the ALREADY-CONFIGURED db client from db.js
//    (db.js handles DynamoDBClient + DynamoDBDocumentClient setup)
const { db, GetCommand, TABLES } = require('./db');

const { upload } = require('./cloudinary');
const dashboardRoutes = require('./routes/dashboard');
const categoryRoutes = require('./routes/categories');
const recycleBinRoutes = require('./routes/recycleBin');
const productRoutes = require('./routes/products');

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// ── CORS & Middleware ───────────────────────────────────────
app.use(cors({
  origin: true, // Allow Vercel frontend & local dev
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check ────────────────────────────────────────────
app.get('/api/health', (req, res) => 
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    endpoint: process.env.LOCALSTACK_ENDPOINT || 'default'
  })
);

// ── PDF printer setup ───────────────────────────────────────
const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};
const printer = new PdfPrinter(fonts);

// ── Routes ──────────────────────────────────────────────────
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/recycle-bin', recycleBinRoutes);
app.use('/api/products', productRoutes);

// ── Image upload (standalone) ───────────────────────────────
app.post('/api/upload-image', upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    res.json({ image_path: req.file.path });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ── PDF generation (uses db from ./db.js) ───────────────────
app.get('/api/products/:id/pdf', async (req, res) => {
  try {
    const result = await db.send(new GetCommand({
      TableName: TABLES.PRODUCTS,
      Key: { productId: parseInt(req.params.id) }, // DynamoDB keys are numbers
    }));

    if (!result.Item) return res.status(404).json({ error: 'Product not found' });

    const product = result.Item;
    
    // Parse technical_details safely
    let techDetails = {};
    const rawTech = product.technical_details;
    if (rawTech && typeof rawTech === 'string') {
      if (rawTech.startsWith('{') && rawTech.endsWith('}')) {
        try { techDetails = JSON.parse(rawTech); }
        catch { techDetails = { Error: 'Invalid JSON format' }; }
      } else if (rawTech === '[object Object]') {
        techDetails = { Error: 'Update product to fix.' };
      } else {
        techDetails = { Details: rawTech };
      }
    } else if (rawTech && typeof rawTech === 'object') {
      techDetails = rawTech;
    } else {
      techDetails = { Details: 'N/A' };
    }

    const formatKey = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const techLines = Object.entries(techDetails).map(([k, v]) => ({
      text: `${formatKey(k)}: ${v}`, style: 'techLine',
    }));

    const docDefinition = {
      pageMargins: [60, 80, 60, 60],
      content: [
        { text: product.name || 'Product', style: 'header' },
        {
          canvas: [{ type: 'line', x1: 0, y1: 5, x2: 500, y2: 5, lineWidth: 1, lineColor: '#4299e1' }],
          margin: [0, 15, 0, 20],
        },
        { text: 'Product Information', style: 'sectionHeader' },
        {
          stack: [
            { text: `Price: $${Number(product.price || 0).toFixed(2)}`, style: 'infoLine' },
            { text: `Description: ${product.description || 'N/A'}`, style: 'infoLine' },
          ],
          margin: [0, 5, 0, 20],
        },
        { text: 'Technical Details', style: 'sectionHeader' },
        {
          stack: techLines.length > 0 ? techLines : [{ text: 'No technical details available.', style: 'details' }],
          margin: [0, 5, 0, 20],
        },
      ],
      styles: {
        header: { fontSize: 26, bold: true, color: '#1a202c', margin: [0, 0, 0, 10] },
        sectionHeader: { fontSize: 18, bold: true, color: '#2d3748', margin: [0, 15, 0, 8] },
        infoLine: { fontSize: 12, color: '#4a5568', margin: [0, 2, 0, 2] },
        techLine: { fontSize: 12, color: '#2d3748', margin: [0, 2, 0, 2] },
        details: { fontSize: 12, color: '#718096', margin: [0, 2, 0, 2] },
      },
      defaultStyle: { font: 'Helvetica', fontSize: 12 },
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${(product.name || 'product').replace(/\s+/g, '_')}_details.pdf"`);
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (err) {
    console.error('PDF generation failed:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// ── Error handler ───────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start server (only in non-Vercel environments) ──────────
// ✅ SINGLE app.listen() — removed duplicate
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🗄️  DynamoDB Endpoint: ${process.env.LOCALSTACK_ENDPOINT || 'default'}`);
  });
}

// ✅ Export app for Vercel serverless + testing
module.exports = app;