const mongoose = require("mongoose");
const { getNextSequence } = require("../helper/counter.js");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      uppercase: true,
    },
    productCode: {
      type: String,
      unique: true,
    },
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
    size: {
      type: String,
      trim: true,
    },
    weight: {
      type: String,
      trim: true,
    },
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
          // .save() -> "this" is the document itself
          if (this.mrp !== undefined) {
            return value <= this.mrp;
          }

          // findByIdAndUpdate() + runValidators -> "this" is the Query
          if (typeof this.getUpdate === "function") {
            const update = this.getUpdate();
            const updatedMrp = update?.$set?.mrp ?? update?.mrp;
            if (updatedMrp !== undefined) {
              return value <= updatedMrp;
            }
          }

          // mrp না পাওয়া গেলে validator pass করে দেওয়া হচ্ছে —
          // controller এ আগেই cross-check হয়ে গেছে, তাই duplicate block হবে না
          return true;
        },
        message: "Offer price cannot be greater than MRP",
      },
    },
    deliveryTime: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
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
  { timestamps: true }
);

productSchema.pre("save", async function () {
  if (this.isNew && !this.productCode) {
    const seq = await getNextSequence("productCode");
    this.productCode = `PRD${String(seq).padStart(6, "0")}`; // PRD000001
  }
});

const ProductModel = mongoose.model("Product", productSchema);

module.exports = ProductModel;