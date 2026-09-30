const { z } = require("zod");
const mongoose = require("mongoose");

const objectId = z.string().refine((val) => mongoose.isValidObjectId(val), {
  message: "Invalid ObjectId",
});

// "" ba "null" pathale null hoye jabe (mane remove / kono value nai)
const nullableObjectId = z.preprocess(
  (v) => (v === "" || v === "null" ? null : v),
  objectId.nullable().optional(),
);

const createBannerSchema = z.object({
  name: z.string().trim().min(1, "Banner name is required"),
  storeId: objectId,
  categoryId: nullableObjectId,
  productId: nullableObjectId,
});

const updateBannerSchema = createBannerSchema.partial();

module.exports = { createBannerSchema, updateBannerSchema };