const mongoose = require("mongoose");
const { getNextSequence } = require("../helper/counter.js");

const variantSchema = new mongoose.Schema(
  {
    size: { type: String, trim: true, uppercase: true },
    weight: { type: String, trim: true, uppercase: true },
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
    stock: { type: Number, default: 0, min: [0, "Stock must be >= 0"] },
    sku: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: false,
    // ✅ FIX: pre("validate", function(next){...}) middleware-er bodole
    // path-level custom validate use kora hocche. findByIdAndUpdate +
    // runValidators diye array subdocument validate hobar somoy mongoose
    // subdoc-er pre-validate hook-e thikmoto "next" pass korte pare na
    // (mongoose-er known limitation), tai "next is not a function" ashe.
    // Path-level validate sync, tai eta shob case-e (save + update) thikmoto kaj kore.
  },
);

// size ba weight - dutor moddhe ekta thakte hobe (sync validator, no "next" needed)
variantSchema.path("size").validate(function (value) {
  return !!value || !!this.weight;
}, "Each variant needs a size or weight");

variantSchema.path("weight").validate(function (value) {
  return !!value || !!this.size;
}, "Each variant needs a size or weight");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      uppercase: true,
    },
    productCode: { type: String, unique: true },
    images: [{ type: String }],
    description: {
      type: String,
      required: [true, "Product description is required"],
      trim: true,
      uppercase: true,
    },
    unit: {
      type: String,
      required: [true, "Unit is required"],
      trim: true,
      uppercase: true,
    },
    variants: {
      type: [variantSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "At least one variant is required",
      },
    },
    deliveryTime: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
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

productSchema.pre("save", async function () {
  if (this.isNew && !this.productCode) {
    const seq = await getNextSequence("productCode");
    this.productCode = `PRD${String(seq).padStart(6, "0")}`;
  }
});

const ProductModel = mongoose.model("Product", productSchema);
module.exports = ProductModel;