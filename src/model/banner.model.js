const mongoose = require("mongoose");

const bannerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Banner name is required"],
      trim: true,
    },
    image: {
      type: String,
      required: [true, "Banner media is required"],
    },
    mediaType: {
      type: String,
      enum: ["image", "video"],
      default: "image",
    },
    isActive: { type: Boolean, default: true },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },
    // optional: category chhara banner "general" banner hishebe thakbe
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    bannerURL: {
      type: String,
      trim: true,
      default: "",
      match: [
        /^https?:\/\/.+/i,
        "Banner URL must start with http:// or https://",
      ],
    },
  },
  { timestamps: true },
);

bannerSchema.index({ storeId: 1, categoryId: 1, isActive: 1, createdAt: -1 });

const BannerModel = mongoose.model("Banner", bannerSchema);
module.exports = BannerModel;