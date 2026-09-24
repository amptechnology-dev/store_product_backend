const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["NEW_ORDER", "ORDER_CANCELLED"],
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    isRead: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

notificationSchema.index({ storeId: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);