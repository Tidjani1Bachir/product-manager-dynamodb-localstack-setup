// ============================================================
// routes/products.js — DynamoDB (AWS SDK v3)
// ============================================================

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');


const {
  db,           // ← was "ddb" — fixed to match db.js export
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
  TABLES,
} = require('../db');

// ─────────── helpers ───────────
const toTech = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v || '');
const toNum  = (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb);
const stockStatus = (qty, th) =>
  qty === 0 ? 'out_of_stock' : qty <= th ? 'low_stock' : 'in_stock';
const nowIso = () => new Date().toISOString();

// ─────────── GET /api/products ───────────
// No GSI defined in db.js for is_active, so we use a Scan with FilterExpression.
// If you add a GSI later, swap this back to QueryCommand.
router.get('/', async (req, res) => {
  try {
    const result = await db.send(
      new ScanCommand({
        TableName:        TABLES.PRODUCTS,
        FilterExpression: 'is_active = :one AND attribute_not_exists(deleted_at)',
        ExpressionAttributeValues: { ':one': 1 },
      })
    );

    const items = (result.Items || []).sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );
    res.json(items);
  } catch (err) {
    console.error('GET /api/products error:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// ─────────── GET /api/products/:id ───────────
router.get('/:id', async (req, res) => {
  try {
    const result = await db.send(
      new GetCommand({
        TableName: TABLES.PRODUCTS,
        Key: { productId: req.params.id },   // ← key name matches db.js schema
      })
    );
    const p = result.Item;
    if (!p || p.is_active === 0 || p.deleted_at) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(p);
  } catch (err) {
    console.error('GET /api/products/:id error:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// ─────────── POST /api/products ───────────
router.post('/', async (req, res) => {
  try {
    const {
      name,
      description        = '',
      technical_details  = '',
      image_path         = '',
      price              = 0,
      category_id        = null,
      quantity           = 0,
      low_stock_threshold = 5,
      created_at,
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    const qty = Math.max(0, toNum(quantity, 0));
    const th  = Math.max(0, toNum(low_stock_threshold, 5));
    const now = nowIso();

    const item = {
      productId:           uuidv4(),   // ← matches HASH key in db.js
      name:                String(name).trim(),
      description,
      technical_details:   toTech(technical_details),
      image_path,
      price:               toNum(price, 0),
      category_id:         category_id || null,
      quantity:            qty,
      low_stock_threshold: th,
      stock_status:        stockStatus(qty, th),
      is_active:           1,
      created_at:          created_at || now,
      updated_at:          now,
    };

    await db.send(new PutCommand({ TableName: TABLES.PRODUCTS, Item: item }));

    // Record initial stock if non-zero
    if (qty > 0) {
      await db.send(
        new PutCommand({
          TableName: TABLES.STOCK_HISTORY,
          Item: {
            historyId:      uuidv4(),        // ← matches HASH key in db.js
            product_id:     item.productId,
            old_quantity:   0,
            new_quantity:   qty,
            change_reason:  'Initial stock',
            changed_at:     now,
          },
        })
      );
    }

    res.status(201).json(item);
  } catch (err) {
    console.error('POST /api/products error:', err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// ─────────── PUT /api/products/:id ───────────
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.send(
      new GetCommand({ TableName: TABLES.PRODUCTS, Key: { productId: id } })
    );
    const p = existing.Item;
    if (!p || p.is_active === 0 || p.deleted_at) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const allowed = [
      'name', 'description', 'technical_details',
      'image_path', 'price', 'category_id', 'created_at',
    ];
    const sets   = [];
    const names  = {};
    const values = {};

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        sets.push(`#${key} = :${key}`);
        names[`#${key}`]  = key;
        values[`:${key}`] =
          key === 'technical_details' ? toTech(req.body[key])
          : key === 'price'           ? toNum(req.body[key], 0)
          : req.body[key];
      }
    }

    const hasQty = req.body.quantity           !== undefined;
    const hasTh  = req.body.low_stock_threshold !== undefined;
    const qty = hasQty ? Math.max(0, toNum(req.body.quantity, 0))           : toNum(p.quantity, 0);
    const th  = hasTh  ? Math.max(0, toNum(req.body.low_stock_threshold, 5)) : toNum(p.low_stock_threshold, 5);

    if (hasQty) {
      sets.push('#quantity = :quantity');
      names['#quantity']  = 'quantity';
      values[':quantity'] = qty;
    }
    if (hasTh) {
      sets.push('#low_stock_threshold = :low_stock_threshold');
      names['#low_stock_threshold']  = 'low_stock_threshold';
      values[':low_stock_threshold'] = th;
    }
    if (hasQty || hasTh) {
      sets.push('#stock_status = :stock_status');
      names['#stock_status']  = 'stock_status';
      values[':stock_status'] = stockStatus(qty, th);
    }

    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

    sets.push('#updated_at = :updated_at');
    names['#updated_at']  = 'updated_at';
    values[':updated_at'] = nowIso();

    const result = await db.send(
      new UpdateCommand({
        TableName:                 TABLES.PRODUCTS,
        Key:                       { productId: id },
        UpdateExpression:          `SET ${sets.join(', ')}`,
        ExpressionAttributeNames:  names,
        ExpressionAttributeValues: values,
        ReturnValues:              'ALL_NEW',
      })
    );

    // Stock history if quantity changed
    if (hasQty && toNum(p.quantity, 0) !== qty) {
      await db.send(
        new PutCommand({
          TableName: TABLES.STOCK_HISTORY,
          Item: {
            historyId:     uuidv4(),
            product_id:    id,
            old_quantity:  toNum(p.quantity, 0),
            new_quantity:  qty,
            change_reason: 'Product updated',
            changed_at:    nowIso(),
          },
        })
      );
    }

    res.json(result.Attributes);
  } catch (err) {
    console.error('PUT /api/products/:id error:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// ─────────── DELETE /api/products/:id (soft delete → recycle bin) ───────────
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.send(
      new GetCommand({ TableName: TABLES.PRODUCTS, Key: { productId: id } })
    );
    const p = existing.Item;
    if (!p || p.deleted_at) return res.status(404).json({ error: 'Product not found' });

    // Look up category name if any
    let deletedCategoryName = 'No Category';
    if (p.category_id) {
      const c = await db.send(
        new GetCommand({ TableName: TABLES.CATEGORIES, Key: { categoryId: p.category_id } })
      );
      if (c.Item) deletedCategoryName = c.Item.name;
    }

    const now       = nowIso();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const ttlEpoch  = Math.floor(expiresAt.getTime() / 1000);

    await db.send(
      new UpdateCommand({
        TableName: TABLES.PRODUCTS,
        Key:       { productId: id },
        UpdateExpression: `
          SET is_active            = :zero,
              deleted_at           = :now,
              recycle_expires_at   = :expIso,
              recycle_expires_ttl  = :ttl,
              deleted_category_id  = :cid,
              deleted_category_name = :cname,
              updated_at           = :now
          REMOVE category_id
        `,
        ExpressionAttributeValues: {
          ':zero':  0,
          ':now':   now,
          ':expIso': expiresAt.toISOString(),
          ':ttl':   ttlEpoch,
          ':cid':   p.category_id || null,
          ':cname': deletedCategoryName,
        },
      })
    );

    res.json({ message: 'Product moved to recycle bin', expiresInDays: 30 });
  } catch (err) {
    console.error('DELETE /api/products/:id error:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// ─────────── POST /api/products/:id/duplicate ───────────
router.post('/:id/duplicate', async (req, res) => {
  try {
    const original = await db.send(
      new GetCommand({ TableName: TABLES.PRODUCTS, Key: { productId: req.params.id } })
    );
    const p = original.Item;
    if (!p || p.is_active === 0 || p.deleted_at) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const qty = Math.max(0, toNum(p.quantity, 0));
    const th  = Math.max(0, toNum(p.low_stock_threshold, 5));
    const now = nowIso();

    const clone = {
      ...p,
      productId:    uuidv4(),
      name:         `${p.name} (Copy)`,
      stock_status: stockStatus(qty, th),
      is_active:    1,
      created_at:   now,
      updated_at:   now,
    };
    delete clone.deleted_at;
    delete clone.recycle_expires_at;
    delete clone.recycle_expires_ttl;
    delete clone.deleted_category_id;
    delete clone.deleted_category_name;

    await db.send(new PutCommand({ TableName: TABLES.PRODUCTS, Item: clone }));
    res.status(201).json(clone);
  } catch (err) {
    console.error('Duplicate error:', err);
    res.status(500).json({ error: 'Failed to duplicate product' });
  }
});

// ─────────── PUT /api/products/:id/stock ───────────
router.put('/:id/stock', async (req, res) => {
  try {
    const { quantity, reason } = req.body;
    const qty = toNum(quantity, NaN);
    if (!Number.isFinite(qty) || qty < 0) {
      return res.status(400).json({ error: 'Valid quantity is required (>= 0)' });
    }

    const existing = await db.send(
      new GetCommand({ TableName: TABLES.PRODUCTS, Key: { productId: req.params.id } })
    );
    const p = existing.Item;
    if (!p || p.is_active === 0 || p.deleted_at) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const oldQty = Math.max(0, toNum(p.quantity, 0));
    const th     = Math.max(0, toNum(p.low_stock_threshold, 5));
    const now    = nowIso();

    const updated = await db.send(
      new UpdateCommand({
        TableName: TABLES.PRODUCTS,
        Key:       { productId: req.params.id },
        UpdateExpression: 'SET quantity = :q, stock_status = :s, updated_at = :u',
        ExpressionAttributeValues: {
          ':q': qty,
          ':s': stockStatus(qty, th),
          ':u': now,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    await db.send(
      new PutCommand({
        TableName: TABLES.STOCK_HISTORY,
        Item: {
          historyId:     uuidv4(),
          product_id:    req.params.id,
          old_quantity:  oldQty,
          new_quantity:  qty,
          change_reason: reason || '',
          changed_at:    now,
        },
      })
    );

    res.json(updated.Attributes);
  } catch (err) {
    console.error('Stock update error:', err);
    res.status(500).json({ error: 'Failed to update stock' });
  }
});

// ─────────── GET /api/products/:id/stock-history ───────────
// No GSI defined in db.js for product_id on StockHistory, so we Scan + filter.
// Add a GSI later for efficiency at scale.
router.get('/:id/stock-history', async (req, res) => {
  try {
    const result = await db.send(
      new ScanCommand({
        TableName:        TABLES.STOCK_HISTORY,
        FilterExpression: 'product_id = :pid',
        ExpressionAttributeValues: { ':pid': req.params.id },
      })
    );

    const items = (result.Items || []).sort(
      (a, b) => new Date(b.changed_at || 0) - new Date(a.changed_at || 0)
    );
    res.json(items);
  } catch (err) {
    console.error('Stock history error:', err);
    res.status(500).json({ error: 'Failed to fetch stock history' });
  }
});

module.exports = router;