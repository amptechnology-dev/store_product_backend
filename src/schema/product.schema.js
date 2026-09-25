const { z } = require("zod");

const createProductSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),
  description: z.string().trim().min(1, "Product description is required"),
  unit: z.string().trim().min(1, "Unit is required"),
  deliveryTime: z.string().trim().optional(),
  storeId: z.string().min(1, "Store is required"),
  categoryId: z.string().min(1, "Category is required"),

  // Real validation store settings onujayi helper/validateProductBySettings.js e hoy,
  // ei layer e sudhu loose/basic type check
  mrp: z.coerce.number().min(0).optional(),
  offerPrice: z.coerce.number().min(0).optional(),
  stock: z.coerce.number().min(0).optional(),
  variants: z.array(z.record(z.any())).optional(),
});

const updateProductSchema = createProductSchema.partial();

module.exports = { createProductSchema, updateProductSchema };