const mongoose = require("mongoose");
const { getNextSequence } = require("../helper/counter.js");

const packagingDetailsSchema = new mongoose.Schema(
  {
    expectedDeliveryDays: { type: Number, min: 0 },
    length: { type: Number, min: 0 },
    breadth: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    weight: { type: Number, min: 0 },
  },
  { _id: false },
);

// nested size/weight/height row inside a color variant
const sizeVariantSchema = new mongoose.Schema(
  {
    size: { type: String, trim: true },
    weight: { type: String, trim: true },
    height: { type: String, trim: true },
    mrp: {
      type: Number,
      required: [true, "MRP is required"],
      min: [0, "MRP must be >= 0"],
    },
    offerPrice: {
      type: Number,
      required: [true, "Offer price is required"],
      min: [0, "Offer price must be >= 0"],
      validate: {
        validator: function (value) {
          return this.mrp === undefined || value <= this.mrp;
        },
        message: "Offer price cannot be greater than MRP",
      },
    },
    openingStock: { type: Number, default: 0, min: 0 },
    currentStock: { type: Number, default: 0, min: 0 },
    sku: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    packagingDetails: packagingDetailsSchema,
  },
  { timestamps: false },
);

// top-level variant: either flat (size/weight/height) OR color (optionally with nested sizeVariants)
const variantSchema = new mongoose.Schema(
  {
    color: { type: String, trim: true },
    images: [{ type: String }],

    size: { type: String, trim: true },
    weight: { type: String, trim: true },
    height: { type: String, trim: true },

    // required ONLY when this variant has no nested sizeVariants
    mrp: {
      type: Number,
      min: [0, "MRP must be >= 0"],
      required: function () {
        return !this.sizeVariants || this.sizeVariants.length === 0;
      },
    },
    offerPrice: {
      type: Number,
      min: [0, "Offer price must be >= 0"],
      required: function () {
        return !this.sizeVariants || this.sizeVariants.length === 0;
      },
      validate: {
        validator: function (value) {
          if (value === undefined || value === null) return true;
          return this.mrp === undefined || value <= this.mrp;
        },
        message: "Offer price cannot be greater than MRP",
      },
    },

    openingStock: { type: Number, default: 0, min: 0 },
    currentStock: { type: Number, default: 0, min: 0 },
    sku: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    packagingDetails: packagingDetailsSchema,

    // present only when hasColor + per-size pricing under this color
    sizeVariants: { type: [sizeVariantSchema], default: [] },
  },
  { timestamps: false },
);

const reviewSchema = new mongoose.Schema(
  {
    comment: { type: String, trim: true },
    rating: {
      type: Number,
      required: [true, "Rating is required"],
      min: [1, "Rating must be at least 1"],
      max: [5, "Rating cannot be more than 5"],
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    image: { type: String, default: null },
  },
  { timestamps: true },
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Product name is required"], trim: true },
    productCode: { type: String, unique: true },
    description: { type: String, required: [true, "Product description is required"], trim: true },
    unit: { type: String, required: [true, "Unit is required"], trim: true },
    deliveryTime: { type: String, trim: true },

    images: [{ type: String }],

    // simple (no-variant) product fields
    mrp: { type: Number, min: [0, "MRP must be >= 0"] },
    offerPrice: { type: Number, min: [0, "Offer price must be >= 0"] },
    openingStock: { type: Number, default: 0, min: 0 },
    currentStock: { type: Number, default: 0, min: 0 },
    packagingDetails: packagingDetailsSchema,

    variants: { type: [variantSchema], default: [] },

    hasVariants: { type: Boolean, default: false },
    hasColor: { type: Boolean, default: false },
    hasStockManagement: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    reviews: [reviewSchema],
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    totalReviews: { type: Number, default: 0 },
  },
  { timestamps: true },
);

productSchema.pre("save", async function () {
  if (this.isNew && !this.productCode) {
    const seq = await getNextSequence("productCode");
    this.productCode = `PRD${String(seq).padStart(6, "0")}`;
  }
});

const ProductModel = mongoose.model("Product", productSchema);
module.exports = ProductModel;