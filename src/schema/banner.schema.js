const { z } = require("zod");
const mongoose = require("mongoose");

const objectId = z.string().refine((val) => mongoose.isValidObjectId(val), {
  message: "Invalid ObjectId",
});

const createBannerSchema = z.object({
  name: z.string().trim().min(1, "Banner name is required"),
  storeId: objectId,
});

const updateBannerSchema = createBannerSchema.partial();

module.exports = { createBannerSchema, updateBannerSchema };