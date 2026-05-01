// ============================================================
// routes/categories.js — DynamoDB (AWS SDK v3)
// ============================================================

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');

const {
  db,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  TABLES,
} = require('../db');

const now = () => new Date().toISOString();

// ── Helper: purge expired recycle-bin items ───────────────────────────────────
// DynamoDB has no DELETE WHERE — we scan for expired items then delete them one
// by one. For a small product manager this is fine. At scale, use DynamoDB TTL
// instead (set a numeric `ttl` attribute in epoch seconds and enable TTL on the
// table — AWS auto-deletes expired items for free, no scan needed).

const purgeExpiredRecycleBin = async () => {
  const nowIso = now();

  // ── Purge expired products ──────────────────────────────────────────────────
  const expiredProducts = await db.send(new ScanCommand({
    TableName:        TABLES.PRODUCTS,
    FilterExpression: 'attribute_exists(deleted_at) AND recycle_expires_at <= :now',
    ExpressionAttributeValues: { ':now': nowIso },
    ProjectionExpression: 'productId',   // fetch only the key — saves bandwidth
  }));

  for (const item of expiredProducts.Items || []) {
    await db.send(new DeleteCommand({
      TableName: TABLES.PRODUCTS,
      Key: { productId: item.productId },
    }));
  }

  // ── Purge expired categories ────────────────────────────────────────────────
  const expiredCategories = await db.send(new ScanCommand({
    TableName:        TABLES.CATEGORIES,
    FilterExpression: 'is_deleted = :one AND recycle_expires_at <= :now',
    ExpressionAttributeValues: { ':one': 1, ':now': nowIso },
    ProjectionExpression: 'categoryId',
  }));

  for (const item of expiredCategories.Items || []) {
    await db.send(new DeleteCommand({
      TableName: TABLES.CATEGORIES,
      Key: { categoryId: item.categoryId },
    }));
  }
};

// ── GET /api/categories ───────────────────────────────────────────────────────
// Returns all active categories with their product count attached.

router.get('/', async (req, res) => {
  try {
    await purgeExpiredRecycleBin();

    // Fetch all non-deleted categories
    const catResult = await db.send(new ScanCommand({
      TableName:        TABLES.CATEGORIES,
      FilterExpression: 'is_deleted = :zero OR attribute_not_exists(is_deleted)',
      ExpressionAttributeValues: { ':zero': 0 },
    }));

    const categories = catResult.Items || [];

    // Count active products per category
    // We do ONE scan of Products and aggregate in JS — avoids N+1 DB calls.
    const prodResult = await db.send(new ScanCommand({
      TableName:        TABLES.PRODUCTS,
      FilterExpression: 'is_active = :one AND attribute_not_exists(deleted_at)',
      ExpressionAttributeValues: { ':one': 1 },
      ProjectionExpression: 'category_id',   // only need this field
    }));

    // Build a map: categoryId → count
    const countMap = {};
    for (const p of prodResult.Items || []) {
      if (p.category_id) {
        countMap[p.category_id] = (countMap[p.category_id] || 0) + 1;
      }
    }

    // Attach product_count to each category and sort A→Z
    const result = categories
      .map(c => ({ ...c, product_count: countMap[c.categoryId] || 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json(result);
  } catch (error) {
    console.error('GET /api/categories error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// ── GET /api/categories/:id ───────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    await purgeExpiredRecycleBin();

    const result = await db.send(new GetCommand({
      TableName: TABLES.CATEGORIES,
      Key: { categoryId: req.params.id },
    }));

    if (!result.Item || result.Item.is_deleted === 1) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json(result.Item);
  } catch (error) {
    console.error('GET /api/categories/:id error:', error);
    res.status(500).json({ error: 'Failed to fetch category' });
  }
});

// ── POST /api/categories ──────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const { name, description = '', color = '#4ecdc4', icon = 'package' } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const trimmedName = String(name).trim();

    // Check for duplicate name (DynamoDB has no UNIQUE constraint — check in JS)
    const allCats = await db.send(new ScanCommand({
      TableName:        TABLES.CATEGORIES,
      FilterExpression: '#nm = :name',
      ExpressionAttributeNames:  { '#nm': 'name' },
      ExpressionAttributeValues: { ':name': trimmedName.toLowerCase() },
      // NOTE: storing name as lowercase for comparison; display name kept original
    }));

    // We compare case-insensitively in JS to match your original LOWER(name) logic
    const existing = (allCats.Items || []).find(
      c => c.name.toLowerCase() === trimmedName.toLowerCase()
    );

    if (existing && existing.is_deleted !== 1) {
      return res.status(409).json({ error: 'Category already exists' });
    }

    // If the name exists but was soft-deleted → restore it (same logic as before)
    if (existing && existing.is_deleted === 1) {
      await db.send(new UpdateCommand({
        TableName: TABLES.CATEGORIES,
        Key:       { categoryId: existing.categoryId },
        UpdateExpression: `SET description = :desc, color = :color, #ic = :icon,
                               is_deleted = :zero, deleted_at = :null,
                               recycle_expires_at = :null`,
        ExpressionAttributeNames:  { '#ic': 'icon' },
        ExpressionAttributeValues: {
          ':desc':  description,
          ':color': color,
          ':icon':  icon,
          ':zero':  0,
          ':null':  null,
        },
      }));

      const restored = await db.send(new GetCommand({
        TableName: TABLES.CATEGORIES,
        Key: { categoryId: existing.categoryId },
      }));
      return res.status(201).json(restored.Item);
    }

    // Create brand new category
    const newCat = {
      categoryId:  uuidv4(),
      name:        trimmedName,
      description,
      color,
      icon,
      is_deleted:  0,
      created_at:  now(),
    };

    await db.send(new PutCommand({ TableName: TABLES.CATEGORIES, Item: newCat }));
    res.status(201).json(newCat);
  } catch (error) {
    console.error('POST /api/categories error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// ── PUT /api/categories/:id ───────────────────────────────────────────────────

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, color, icon } = req.body;

    const setExpressions = [];
    const expressionNames  = {};
    const expressionValues = {};

    const addField = (attr, value) => {
      setExpressions.push(`#${attr} = :${attr}`);
      expressionNames[`#${attr}`]  = attr;
      expressionValues[`:${attr}`] = value;
    };

    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'Category name cannot be empty' });
      addField('name', String(name).trim());
    }
    if (description !== undefined) addField('description', description);
    if (color       !== undefined) addField('color', color);
    if (icon        !== undefined) addField('icon', icon);

    if (!setExpressions.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Verify it exists and is not deleted
    const check = await db.send(new GetCommand({
      TableName: TABLES.CATEGORIES,
      Key: { categoryId: id },
    }));
    if (!check.Item || check.Item.is_deleted === 1) {
      return res.status(404).json({ error: 'Category not found' });
    }

    await db.send(new UpdateCommand({
      TableName:                 TABLES.CATEGORIES,
      Key:                       { categoryId: id },
      UpdateExpression:          `SET ${setExpressions.join(', ')}`,
      ExpressionAttributeNames:  expressionNames,
      ExpressionAttributeValues: expressionValues,
    }));

    const updated = await db.send(new GetCommand({
      TableName: TABLES.CATEGORIES,
      Key: { categoryId: id },
    }));

    res.json(updated.Item);
  } catch (error) {
    console.error('PUT /api/categories/:id error:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// ── DELETE /api/categories/:id ────────────────────────────────────────────────
// Soft-deletes the category AND all its active products (same as original)

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await purgeExpiredRecycleBin();

    // Verify category exists
    const catResult = await db.send(new GetCommand({
      TableName: TABLES.CATEGORIES,
      Key: { categoryId: id },
    }));
    if (!catResult.Item || catResult.Item.is_deleted === 1) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const category  = catResult.Item;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Find all active products belonging to this category
    const prodResult = await db.send(new ScanCommand({
      TableName:        TABLES.PRODUCTS,
      FilterExpression: 'category_id = :cid AND is_active = :one AND attribute_not_exists(deleted_at)',
      ExpressionAttributeValues: { ':cid': id, ':one': 1 },
      ProjectionExpression: 'productId',
    }));

    const relatedProducts = prodResult.Items || [];

    // Soft-delete each product
    for (const p of relatedProducts) {
      await db.send(new UpdateCommand({
        TableName: TABLES.PRODUCTS,
        Key:       { productId: p.productId },
        UpdateExpression: `SET is_active = :zero,
                               deleted_at = :deletedAt,
                               recycle_expires_at = :expiresAt,
                               deleted_category_id = :catId,
                               deleted_category_name = :catName,
                               updated_at = :now`,
        ExpressionAttributeValues: {
          ':zero':     0,
          ':deletedAt': now(),
          ':expiresAt': expiresAt,
          ':catId':    id,
          ':catName':  category.name,
          ':now':      now(),
        },
      }));
    }

    // Soft-delete the category itself
    await db.send(new UpdateCommand({
      TableName: TABLES.CATEGORIES,
      Key:       { categoryId: id },
      UpdateExpression: `SET is_deleted = :one,
                             deleted_at = :deletedAt,
                             recycle_expires_at = :expiresAt`,
      ExpressionAttributeValues: {
        ':one':       1,
        ':deletedAt': now(),
        ':expiresAt': expiresAt,
      },
    }));

    res.json({
      message: 'Category and related products moved to recycle bin',
      deletedProductsCount: relatedProducts.length,
      expiresInDays: 30,
    });
  } catch (error) {
    console.error('DELETE /api/categories/:id error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

module.exports = router;