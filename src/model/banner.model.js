const mongoose = require("mongoose");

const bannerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Banner name is required"],
      trim: true,
      uppercase: true,
    },
    image: {
      type: String,
      required: [true, "Banner image is required"],
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
  },
  { timestamps: true },
);

const BannerModel = mongoose.model("Banner", bannerSchema);
module.exports = BannerModel;