const { z } = require("zod");

const MAX_ITEM_QUANTITY = 10;
const MAX_CART_LINES = 50;

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

// "" / null / undefined shob undefined hoye jabe
const optionalText = z
  .string()
  .trim()
  .max(50)
  .nullish()
  .transform((v) => v || undefined);

const quantity = z.coerce
  .number()
  .int("Quantity must be a whole number")
  .min(1, "Quantity must be at least 1")
  .max(MAX_ITEM_QUANTITY, `Maximum ${MAX_ITEM_QUANTITY} units allowed per item`);

const addToCartSchema = z.object({
  productId: objectId,
  quantity: quantity.default(1),
  size: optionalText,
  weight: optionalText,
});

const updateCartItemSchema = z.object({
  quantity,
});

module.exports = {
  addToCartSchema,
  updateCartItemSchema,
  MAX_ITEM_QUANTITY,
  MAX_CART_LINES,
};