const mongoose = require("mongoose");
const { model } = mongoose;

const addressSchema = new mongoose.Schema(
  {
    addressLine: { type: String, required: true, trim: true },
    area: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
    country: { type: String, default: "India", trim: true },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String },
    password: { type: String },
    role: {
      type: String,
      enum: ["ADMIN", "STORE", "USER"],
      default: "ADMIN",
    },
    googleId: { type: String },
    picture: { type: String },
    provider: {
      type: String,
      enum: ["LOCAL", "GOOGLE"],
      default: "LOCAL",
    },
    address: { type: addressSchema, default: null },
    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const UserModel = model("User", userSchema);

module.exports = UserModel;
