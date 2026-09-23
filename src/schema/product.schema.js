const { z } = require("zod");

const variantInputSchema = z
  .object({
    size: z.string().trim().optional(),
    weight: z.string().trim().optional(),
    mrp: z.coerce.number().min(0, "MRP must be >= 0"),
    offerPrice: z.coerce.number().min(0, "Offer price must be >= 0"),
    stock: z.coerce.number().min(0).optional().default(0),
    sku: z.string().trim().optional(),
  })
  .refine((v) => v.size || v.weight, {
    message: "Each variant needs a size or weight",
    path: ["size"],
  })
  .refine((v) => v.offerPrice <= v.mrp, {
    message: "Offer price cannot be greater than MRP",
    path: ["offerPrice"],
  });

const createProductSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  deliveryTime: z.string().trim().optional(),
  storeId: z.string(),
  categoryId: z.string(),
  variants: z.array(variantInputSchema).min(1, "At least one variant is required"),
});

const updateProductSchema = createProductSchema.partial().extend({
  variants: z.array(variantInputSchema).min(1).optional(),
});

module.exports = { createProductSchema, updateProductSchema };