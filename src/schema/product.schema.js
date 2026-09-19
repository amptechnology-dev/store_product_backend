const { z } = require("zod");

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Id");

const createProductSchema = z
  .object({
    name: z.string().trim().min(1, "Product name is required"),
    description: z.string().trim().min(1, "Description is required"),
    unit: z.string().trim().min(1, "Unit is required"),
    size: z.string().trim().optional(),
    weight: z.string().trim().optional(),
    mrp: z.coerce.number().min(0, "MRP must be >= 0"),
    offerPrice: z.coerce.number().min(0, "Offer price must be >= 0"),
    deliveryTime: z.string().trim().optional(),
    storeId: objectId,
    categoryId: objectId,
  })
  .refine((data) => data.offerPrice <= data.mrp, {
    message: "Offer price cannot be greater than MRP",
    path: ["offerPrice"],
  });

const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    unit: z.string().trim().min(1).optional(),
    size: z.string().trim().optional(),
    weight: z.string().trim().optional(),
    mrp: z.coerce.number().min(0).optional(),
    offerPrice: z.coerce.number().min(0).optional(),
    deliveryTime: z.string().trim().optional(),
    categoryId: objectId.optional(),
  })
  .refine(
    (data) =>
      data.mrp === undefined || data.offerPrice === undefined
        ? true
        : data.offerPrice <= data.mrp,
    {
      message: "Offer price cannot be greater than MRP",
      path: ["offerPrice"],
    },
  );

module.exports = { createProductSchema, updateProductSchema };
