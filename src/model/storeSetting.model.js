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
    hasStockManagement: { type: Boolean, default: false },
    hasDelivery: { type: Boolean, default: true },
    paymentFirst: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const StoreSettingModel = model("StoreSetting", storeSettingSchema);
module.exports = StoreSettingModel;
