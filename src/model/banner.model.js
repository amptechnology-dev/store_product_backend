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

const BannerModel = mongoose.model("Banner", bannerSchema);
module.exports = BannerModel;
