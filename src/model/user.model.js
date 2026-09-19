const mongoose = require("mongoose");
const { model } = mongoose;

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },

    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true
    },

    phone: { type: String },

    password: {
        type: String,
    },
    role: {
        type: String,
        enum: ["ADMIN", "STORE","USER"],
        default: "ADMIN"
    },
    googleId: {
        type: String
    },

    picture: {
        type: String
    },
    provider: {
        type: String,
        enum: ["LOCAL", "GOOGLE"],
        default: "LOCAL"
    },

    isActive: {
        type: Boolean,
        default: true
    },
    isVerified: {
        type: Boolean,
        default: false
    }

}, { timestamps: true });

const UserModel = model("User", userSchema);

module.exports = UserModel;