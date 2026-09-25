const { z } = require("zod");

const variantInputSchema = z
  .object({
    color: z.string().trim().optional(),
    size: z.string().trim().optional(),
    weight: z.string().trim().optional(),
    height: z.string().trim().optional(),
    images: z.array(z.string()).optional(),
    mrp: z.coerce.number({ required_error: "MRP is required" }).min(0),
    offerPrice: z.coerce.number({ required_error: "Offer price is required" }).min(0),
    stock: z.coerce.number().min(0).optional(),
    sku: z.string().trim().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.offerPrice <= v.mrp, {
    message: "Offer price cannot be greater than MRP",
    path: ["offerPrice"],
  });

/**
 * Store settings onujayi product body validate kore, clean data return kore.
 * @param {{hasVariants:boolean, hasColor:boolean, hasStockManagement:boolean}} settings
 * @param {object} body - req.body (variants already JSON.parse kora thakte hobe)
 */
const validateProductBySettings = (settings, body) => {
  const { hasVariants, hasColor, hasStockManagement } = settings;
  const usesVariants = hasVariants || hasColor;
  const errors = [];

  if (usesVariants) {
    if (!Array.isArray(body.variants) || body.variants.length === 0) {
      return {
        errors: [{ field: "variants", message: "At least one variant is required" }],
        data: {},
        usesVariants,
      };
    }

    const cleanVariants = [];

    body.variants.forEach((variant, idx) => {
      const result = variantInputSchema.safeParse(variant);
      if (!result.success) {
        result.error.issues.forEach((issue) => {
          errors.push({
            field: `variants[${idx}]${issue.path.length ? "." + issue.path.join(".") : ""}`,
            message: issue.message,
          });
        });
        return;
      }

      const v = result.data;

      if (hasVariants && !v.size && !v.weight && !v.height) {
        errors.push({
          field: `variants[${idx}]`,
          message: "Size, weight or height is required for each variant",
        });
      }
      if (hasColor && !v.color) {
        errors.push({
          field: `variants[${idx}].color`,
          message: "Color is required for each variant",
        });
      }
      if (!hasStockManagement) {
        delete v.stock;
      } else if (v.stock === undefined) {
        v.stock = 0;
      }

      cleanVariants.push(v);
    });

    return {
      errors,
      data: { variants: cleanVariants, mrp: undefined, offerPrice: undefined, stock: undefined },
      usesVariants,
    };
  }

  // ---------- Simple mode: variant o color duitai off ----------
  if (body.mrp === undefined || body.mrp === null || Number.isNaN(Number(body.mrp))) {
    errors.push({ field: "mrp", message: "MRP is required" });
  }
  if (body.offerPrice === undefined || body.offerPrice === null || Number.isNaN(Number(body.offerPrice))) {
    errors.push({ field: "offerPrice", message: "Offer price is required" });
  }
  if (!errors.length && Number(body.offerPrice) > Number(body.mrp)) {
    errors.push({ field: "offerPrice", message: "Offer price cannot be greater than MRP" });
  }

  const data = {
    mrp: Number(body.mrp),
    offerPrice: Number(body.offerPrice),
    variants: [],
  };
  if (hasStockManagement) {
    data.stock = body.stock !== undefined ? Number(body.stock) : 0;
  }

  return { errors, data, usesVariants };
};

module.exports = { validateProductBySettings };