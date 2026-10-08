const mongoose = require("mongoose");
const { getNextSequence } = require("../helper/counter.js");

const ORDER_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
];

const orderItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  variantId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  name: { type: String, required: true },
  productCode: { type: String },
  image: { type: String, default: null },
  unit: { type: String },
  color: { type: String, default: null },
  size: { type: String, default: null },
  weight: { type: String, default: null },
  height: { type: String, default: null },
  // price-on-request item e checkout-er somoy null, user quote accept korle fill hoy
  mrp: { type: Number, default: null, min: 0 },
  offerPrice: { type: Number, default: null, min: 0 },
  quantity: { type: Number, required: true, min: 1 },
  lineTotal: { type: Number, default: null, min: 0 },
  priceOnRequest: { type: Boolean, default: false },
});

const deliveryAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    addressLine: { type: String, required: true, trim: true },
    area: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
    country: { type: String, default: "India", trim: true },
  },
  { _id: false },
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, enum: ORDER_STATUSES, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    note: { type: String, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

// store er pathano estimated price
const quoteSchema = new mongoose.Schema(
  {
    items: [
      new mongoose.Schema(
        {
          itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
          unitPrice: { type: Number, required: true, min: 0 },
        },
        { _id: false },
      ),
    ],
    total: { type: Number, min: 0 },
    note: { type: String, default: null },
    quotedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    quotedAt: { type: Date },
  },
  { _id: false },
);

const priceHistorySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["QUOTED", "ACCEPTED", "REJECTED"],
      required: true,
    },
    byRole: { type: String, enum: ["STORE", "USER"] },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    total: { type: Number },
    note: { type: String, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, unique: true },

    cartId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cart",
      default: null,
    },
    checkoutId: { type: mongoose.Schema.Types.ObjectId, default: null },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },

    storeName: { type: String },
    storeUniqueId: { type: String },

    items: {
      type: [orderItemSchema],
      validate: [(v) => v.length > 0, "Order must have at least one item"],
    },

    totalItems: { type: Number, required: true, min: 1 },
    totalMrp: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },

    deliveryAddress: { type: deliveryAddressSchema, required: true },
    note: { type: String, default: null },
    expectedDeliveryDate: { type: Date, default: null },

    paymentMethod: { type: String, enum: ["COD"], default: "COD" },
    paymentStatus: {
      type: String,
      enum: ["PENDING", "PAID"],
      default: "PENDING",
    },

    status: { type: String, enum: ORDER_STATUSES, default: "PENDING" },
    statusHistory: [statusHistorySchema],

    // price-on-request flow
    priceStatus: {
      type: String,
      enum: ["NOT_REQUIRED", "AWAITING_QUOTE", "QUOTED", "CONFIRMED"],
      default: "NOT_REQUIRED",
    },
    quote: { type: quoteSchema, default: null },
    priceHistory: { type: [priceHistorySchema], default: [] },

    cancelReason: { type: String, default: null },
    cancelledBy: { type: String, enum: ["USER", "STORE"], default: null },
  },
  { timestamps: true },
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ userId: 1, storeId: 1, createdAt: -1 });
orderSchema.index({ storeId: 1, status: 1, createdAt: -1 });
orderSchema.index({ storeId: 1, priceStatus: 1, createdAt: -1 });
orderSchema.index({ checkoutId: 1 });

orderSchema.pre("save", async function () {
  if (this.isNew && !this.orderNumber) {
    const seq = await getNextSequence("orderNumber");
    this.orderNumber = `ORD${String(seq).padStart(6, "0")}`;
  }
});

const OrderModel = mongoose.model("Order", orderSchema);

module.exports = OrderModel;