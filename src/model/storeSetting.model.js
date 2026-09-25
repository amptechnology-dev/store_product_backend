const mongoose = require("mongoose");
const { model } = mongoose;

const storeSettingSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      unique: true,
    },
    hasVariants: { type: Boolean, default: false }, // size/weight/height wise variant on/off
    hasColor: { type: Boolean, default: false }, // color wise variant + image on/off
    hasStockManagement: { type: Boolean, default: false }, // stock field on/off
  },
  { timestamps: true },
);

const StoreSettingModel = model("StoreSetting", storeSettingSchema);
module.exports = StoreSettingModel;