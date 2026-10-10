const mongoose = require("mongoose");

const storeDeliverySchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      unique: true, // ek store = ek delivery setting
    },
    // LOCAL = shudhu radius er moddhe, NATIONAL = courier diye shara desh, BOTH = duto-i
    deliveryType: {
      type: String,
      enum: ["LOCAL", "NATIONAL", "BOTH"],
      required: true,
    },
    pincode: { type: String, required: true, trim: true }, // store er pincode
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true },
    },

    // ---------- LOCAL ----------
    radiusKm: { type: Number, default: null, min: 0 },
    localDeliveryDays: { type: Number, default: 1, min: 0 },

    // ---------- NATIONAL (courier / Shiprocket) ----------
    nationalMinDays: { type: Number, default: 3, min: 0 },
    nationalMaxDays: { type: Number, default: 7, min: 0 },

    // order pack / dispatch korte lagbe koydin (LOCAL + NATIONAL duto-te jog hobe)
    handlingDays: { type: Number, default: 1, min: 0 },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("StoreDelivery", storeDeliverySchema);