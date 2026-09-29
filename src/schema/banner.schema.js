const { z } = require("zod");
const mongoose = require("mongoose");

const objectId = z.string().refine((val) => mongoose.isValidObjectId(val), {
  message: "Invalid ObjectId",
});

const bannerURLSchema = z
  .string()
  .trim()
  .max(2048, "URL is too long")
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol);
    } catch {
      return false;
    }
  }, "Enter a valid URL starting with http:// or https://")
  .optional();

const createBannerSchema = z.object({
  name: z.string().trim().min(1, "Banner name is required"),
  storeId: objectId,
  bannerURL: bannerURLSchema,
});

const updateBannerSchema = createBannerSchema.partial();

module.exports = { createBannerSchema, updateBannerSchema };