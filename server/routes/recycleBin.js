// ============================================================
// routes/recycleBin.js — DynamoDB (AWS SDK v3)
// ============================================================

const express = require('express');
const router  = express.Router();

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

// ── Helper: purge expired items ───────────────────────────────────────────────
// Scans for items past their recycle_expires_at and hard-deletes them.
// Called on every GET so the bin is always clean before showing the user.

const purgeExpiredRecycleBin = async () => {
  const nowIso = now();

  // Expired products
  const expiredProducts = await db.send(new ScanCommand({
    TableName:        TABLES.PRODUCTS,
    FilterExpression: 'attribute_exists(deleted_at) AND recycle_expires_at <= :now',
    ExpressionAttributeValues: { ':now': nowIso },
    ProjectionExpression: 'productId',
  }));
  for (const item of expiredProducts.Items || []) {
    await db.send(new DeleteCommand({
      TableName: TABLES.PRODUCTS,
      Key: { productId: item.productId },
    }));
  }

  // Expired categories
  const expiredCats = await db.send(new ScanCommand({
    TableName:        TABLES.CATEGORIES,
    FilterExpression: 'is_deleted = :one AND recycle_expires_at <= :now',
    ExpressionAttributeValues: { ':one': 1, ':now': nowIso },
    ProjectionExpression: 'categoryId',
  }));
  for (const item of expiredCats.Items || []) {
    await db.send(new DeleteCommand({
      TableName: TABLES.CATEGORIES,
      Key: { categoryId: item.categoryId },
    }));
  }
};

// ── GET /api/recycle-bin ──────────────────────────────────────────────────────
// Returns all soft-deleted categories and products, newest first.

router.get('/', async (req, res) => {
  try {
    await purgeExpiredRecycleBin();

    const [catsResult, prodsResult] = await Promise.all([
      db.send(new ScanCommand({
        TableName:        TABLES.CATEGORIES,
        FilterExpression: 'is_deleted = :one',
        ExpressionAttributeValues: { ':one': 1 },
      })),
      db.send(new ScanCommand({
        TableName:        TABLES.PRODUCTS,
        FilterExpression: 'attribute_exists(deleted_at)',
      })),
    ]);

    // Sort newest-deleted first (matching original ORDER BY deleted_at DESC)
    const categories = (catsResult.Items || [])
      .sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at))
      .map(({ categoryId, name, description, color, icon, deleted_at, recycle_expires_at }) => ({
        id: categoryId, name, description, color, icon, deleted_at, recycle_expires_at,
      }));

    const products = (prodsResult.Items || [])
      .sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at))
      .map(({ productId, name, description, image_path, price, quantity,
              deleted_at, recycle_expires_at, deleted_category_id, deleted_category_name }) => ({
        id: productId, name, description, image_path, price, quantity,
        deleted_at, recycle_expires_at, deleted_category_id, deleted_category_name,
      }));

    res.json({ categories, products });
  } catch (error) {
    console.error('GET /api/recycle-bin error:', error);
    res.status(500).json({ error: 'Failed to fetch recycle bin data' });
  }
});

// ── POST /api/recycle-bin/products/:id/restore ────────────────────────────────
// Restores a single product with no category (same as original — "Category None")

router.post('/products/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify it exists before trying to restore
    const check = await db.send(new GetCommand({
      TableName: TABLES.PRODUCTS,
      Key: { productId: id },
    }));
    if (!check.Item) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await db.send(new UpdateCommand({
      TableName: TABLES.PRODUCTS,
      Key:       { productId: id },
      UpdateExpression: `SET is_active = :one,
                             category_id = :null,
                             updated_at = :now
                         REMOVE deleted_at,
                                recycle_expires_at,
                                deleted_category_id,
                                deleted_category_name`,
      ExpressionAttributeValues: {
        ':one':  1,
        ':null': null,
        ':now':  now(),
      },
    }));

    const result = await db.send(new GetCommand({
      TableName: TABLES.PRODUCTS,
      Key: { productId: id },
    }));

    if (!result.Item) {
      return res.status(404).json({ error: 'Product not found after restore' });
    }

    // Map productId → id for frontend compatibility
    const { productId, ...rest } = result.Item;
    res.json({ id: productId, ...rest });
  } catch (error) {
    console.error('POST /api/recycle-bin/products/:id/restore error:', error);
    res.status(500).json({ error: 'Failed to restore product' });
  }
});

// ── POST /api/recycle-bin/categories/:id/restore ──────────────────────────────
// Restores the category AND all products that were deleted with it.

router.post('/categories/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;

    // Find all products that were deleted as part of this category deletion
    const relatedProds = await db.send(new ScanCommand({
      TableName:        TABLES.PRODUCTS,
      FilterExpression: 'attribute_exists(deleted_at) AND deleted_category_id = :cid',
      ExpressionAttributeValues: { ':cid': id },
      ProjectionExpression: 'productId',
    }));

    // Restore each product, reassigning it back to this category
    for (const p of relatedProds.Items || []) {
      await db.send(new UpdateCommand({
        TableName: TABLES.PRODUCTS,
        Key:       { productId: p.productId },
        UpdateExpression: `SET is_active = :one,
                               category_id = :cid,
                               updated_at = :now
                           REMOVE deleted_at,
                                  recycle_expires_at,
                                  deleted_category_id,
                                  deleted_category_name`,
        ExpressionAttributeValues: {
          ':one': 1,
          ':cid': id,
          ':now': now(),
        },
      }));
    }

    // Restore the category itself
    await db.send(new UpdateCommand({
      TableName: TABLES.CATEGORIES,
      Key:       { categoryId: id },
      UpdateExpression: `SET is_deleted = :zero
                         REMOVE deleted_at, recycle_expires_at`,
      ExpressionAttributeValues: { ':zero': 0 },
    }));

    const result = await db.send(new GetCommand({
      TableName: TABLES.CATEGORIES,
      Key: { categoryId: id },
    }));
    if (!result.Item) {
      return res.status(404).json({ error: 'Category not found after restore' });
    }

    const { categoryId, ...rest } = result.Item;
    res.json({ id: categoryId, ...rest });
  } catch (error) {
    console.error('POST /api/recycle-bin/categories/:id/restore error:', error);
    res.status(500).json({ error: 'Failed to restore category' });
  }
});

// ── DELETE /api/recycle-bin/products/:id/permanent ───────────────────────────
// Hard-deletes a product from the recycle bin.

router.delete('/products/:id/permanent', async (req, res) => {
  try {
    const { id } = req.params;

    const check = await db.send(new GetCommand({
      TableName: TABLES.PRODUCTS,
      Key: { productId: id },
    }));
    if (!check.Item) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await db.send(new DeleteCommand({
      TableName: TABLES.PRODUCTS,
      Key: { productId: id },
    }));

    console.log(`Product ${id} permanently deleted`);
    res.json({ success: true, message: 'Product permanently deleted' });
  } catch (error) {
    console.error('DELETE /api/recycle-bin/products/:id/permanent error:', error);
    res.status(500).json({ error: 'Failed to permanently delete product' });
  }
});

module.exports = router;