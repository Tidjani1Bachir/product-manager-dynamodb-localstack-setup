// ============================================================
// routes/dashboard.js — DynamoDB (AWS SDK v3)
// ============================================================
// All aggregation that SQLite did in one query is now done in JS
// after fetching the raw items. This is the standard pattern for
// DynamoDB — compute in application code, not in the DB.
// ============================================================

const express = require('express');
const router  = express.Router();

const {
  db,
  ScanCommand,
  TABLES,
} = require('../db');

// ── Timeout wrapper (same as original) ───────────────────────────────────────
const executeWithTimeout = async (fn, timeoutMs = 15000) => {
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout')), timeoutMs)
      ),
    ]);
  } catch (err) {
    console.warn(`Query timeout or error (${timeoutMs}ms):`, err.message);
    return null;
  }
};

const EMPTY_DASHBOARD_STATS = {
  totalProducts:       0,
  totalInventoryValue: 0,
  averagePrice:        0,
  totalUnits:          0,
  outOfStockCount:     0,
  lowStockCount:       0,
  inStockCount:        0,
  totalCategories:     0,
};

// ── GET /api/dashboard/stats ──────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    // ── Fetch raw data ──────────────────────────────────────────────────────
    // Two scans in parallel: products + categories.
    // DynamoDB doesn't support JOINs — we join in JS.

    const [productsResult, categoriesResult] = await Promise.all([
      executeWithTimeout(
        () => db.send(new ScanCommand({
          TableName:        TABLES.PRODUCTS,
          FilterExpression: 'is_active = :one AND attribute_not_exists(deleted_at)',
          ExpressionAttributeValues: { ':one': 1 },
        })),
        5000
      ),
      executeWithTimeout(
        () => db.send(new ScanCommand({
          TableName:        TABLES.CATEGORIES,
          FilterExpression: 'is_deleted = :zero OR attribute_not_exists(is_deleted)',
          ExpressionAttributeValues: { ':zero': 0 },
        })),
        5000
      ),
    ]);

    // Core stats failed → return fallback payload (same behaviour as original)
    if (!productsResult) {
      return res.json({
        stats: { ...EMPTY_DASHBOARD_STATS },
        categoryBreakdown:   [],
        categoryTimeSeries:  [],
        priceDistribution:   [],
        stockDistribution:   [],
        recentProducts:      [],
        lowStockAlerts:      [],
        warning: 'Dashboard data is temporarily delayed',
      });
    }

    const products   = productsResult.Items  || [];
    const categories = categoriesResult?.Items || [];

    // ── Core stats ──────────────────────────────────────────────────────────
    const totalProducts       = products.length;
    const totalInventoryValue = products.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.quantity) || 0), 0);
    const averagePrice        = totalProducts > 0 ? products.reduce((s, p) => s + (Number(p.price) || 0), 0) / totalProducts : 0;
    const totalUnits          = products.reduce((s, p) => s + (Number(p.quantity) || 0), 0);
    const outOfStockCount     = products.filter(p => Number(p.quantity) === 0).length;
    const lowStockCount       = products.filter(p => Number(p.quantity) > 0 && Number(p.quantity) <= Number(p.low_stock_threshold || 5)).length;
    const inStockCount        = products.filter(p => Number(p.quantity) > (Number(p.low_stock_threshold) || 5)).length;
    const totalCategories     = categories.length;

    const stats = {
      totalProducts,
      totalInventoryValue,
      averagePrice,
      totalUnits,
      outOfStockCount,
      lowStockCount,
      inStockCount,
      totalCategories,
    };

    // ── Category breakdown ──────────────────────────────────────────────────
    // Build a map categoryId → category for quick lookup
    const catMap = {};
    for (const c of categories) {
      catMap[c.categoryId] = c;
    }

    const catAgg = {};
    for (const p of products) {
      const cid = p.category_id || '__none__';
      if (!catAgg[cid]) {
        catAgg[cid] = {
          categoryId:    cid,
          category:      catMap[cid]?.name  || 'No Category',
          color:         catMap[cid]?.color || '#6b7280',
          productCount:  0,
          totalStock:    0,
          categoryValue: 0,
        };
      }
      catAgg[cid].productCount  += 1;
      catAgg[cid].totalStock    += Number(p.quantity) || 0;
      catAgg[cid].categoryValue += (Number(p.price) || 0) * (Number(p.quantity) || 0);
    }

    const categoryBreakdown = Object.values(catAgg)
      .sort((a, b) => b.productCount - a.productCount || a.category.localeCompare(b.category));

    // ── Category time series ────────────────────────────────────────────────
    // Group by YYYY-MM + categoryId (replicating your SQL GROUP BY year, month, c.id)
    const tsAgg = {};
    for (const p of products) {
      if (!p.created_at || !p.category_id) continue;
      const cat = catMap[p.category_id];
      if (!cat) continue;

      const d          = new Date(p.created_at);
      const year       = d.getFullYear();
      const month      = d.getMonth() + 1;
      const monthLabel = `${year}-${String(month).padStart(2, '0')}`;
      const key        = `${monthLabel}__${p.category_id}`;

      if (!tsAgg[key]) {
        tsAgg[key] = {
          year,
          month,
          monthLabel,
          categoryId:   p.category_id,
          category:     cat.name,
          color:        cat.color,
          productCount: 0,
          totalStock:   0,
          categoryValue: 0,
        };
      }
      tsAgg[key].productCount  += 1;
      tsAgg[key].totalStock    += Number(p.quantity) || 0;
      tsAgg[key].categoryValue += (Number(p.price) || 0) * (Number(p.quantity) || 0);
    }

    const categoryTimeSeries = Object.values(tsAgg)
      .sort((a, b) => b.year - a.year || b.month - a.month || b.productCount - a.productCount);

    // ── Price distribution ──────────────────────────────────────────────────
    const priceBuckets = {
      '$0-$10':    { priceRange: '$0-$10',    count: 0 },
      '$10-$50':   { priceRange: '$10-$50',   count: 0 },
      '$50-$100':  { priceRange: '$50-$100',  count: 0 },
      '$100-$500': { priceRange: '$100-$500', count: 0 },
      '$500+':     { priceRange: '$500+',     count: 0 },
    };
    const bucketOrder = ['$0-$10', '$10-$50', '$50-$100', '$100-$500', '$500+'];

    for (const p of products) {
      const price = Number(p.price) || 0;
      if      (price < 10)  priceBuckets['$0-$10'].count++;
      else if (price < 50)  priceBuckets['$10-$50'].count++;
      else if (price < 100) priceBuckets['$50-$100'].count++;
      else if (price < 500) priceBuckets['$100-$500'].count++;
      else                  priceBuckets['$500+'].count++;
    }

    const priceDistribution = bucketOrder
      .map(k => priceBuckets[k])
      .filter(b => b.count > 0);

    // ── Stock distribution ──────────────────────────────────────────────────
    const stockAgg = { out_of_stock: 0, low_stock: 0, in_stock: 0 };
    for (const p of products) {
      const qty = Number(p.quantity) || 0;
      const th  = Number(p.low_stock_threshold) || 5;
      if      (qty === 0)   stockAgg.out_of_stock++;
      else if (qty <= th)   stockAgg.low_stock++;
      else                  stockAgg.in_stock++;
    }
    const stockDistribution = Object.entries(stockAgg)
      .map(([status, count]) => ({ status, count }))
      .filter(s => s.count > 0);

    // ── Recent products (last 5) ────────────────────────────────────────────
    const recentProducts = [...products]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
      .map(({ productId, name, price, quantity, low_stock_threshold, stock_status, created_at }) => ({
        id: productId, name, price, quantity, low_stock_threshold, stock_status, created_at,
      }));

    // ── Low stock alerts ────────────────────────────────────────────────────
    const lowStockAlerts = products
      .filter(p => (Number(p.quantity) || 0) <= (Number(p.low_stock_threshold) || 5))
      .sort((a, b) => Number(a.quantity) - Number(b.quantity) || a.name.localeCompare(b.name))
      .map(p => ({
        id:             p.productId,
        name:           p.name,
        quantity:       p.quantity,
        low_stock_threshold: p.low_stock_threshold,
        stock_status:   p.stock_status,
        category_name:  catMap[p.category_id]?.name  || null,
        category_color: catMap[p.category_id]?.color || null,
      }));

    res.json({
      stats,
      categoryBreakdown,
      categoryTimeSeries,
      priceDistribution,
      stockDistribution,
      recentProducts,
      lowStockAlerts,
    });
  } catch (error) {
    console.error('Dashboard stats error:', error.message);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

module.exports = router;