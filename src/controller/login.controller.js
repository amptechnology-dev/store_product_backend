const mongoose = require("mongoose");
const UserModel = require("../model/user.model.js")
const StoreModel = require("../model/store.model.js")
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { passwordGenerator } = require("../helper/PasswordGenerator.js")
const { loginSchema } = require("../schema/user.schema.js");
const uploadSingleImage = require("../helper/upload.js");
const sendPasswordEmail = require("../helper/mail.service.js")
const transporter = require("../helper/emailtransporter.js")
const { comparePassword } = require("../helper/comparePassword.js")
const { OAuth2Client } = require("google-auth-library");

const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID
);

const continueWithGoogle = async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({
                message: "Google token is required"
            });
        }
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();

        const {
            sub,
            email,
            name,
            picture
        } = payload;

        let user = await UserModel.findOne({ email });

        if (!user) {
            user = await UserModel.create({
                name,
                email,
                googleId: sub,
                picture,
                provider: "GOOGLE",
                role: "USER",
                isVerified: true
            });

        }

        const accessToken = jwt.sign(
            {
                userId: user._id,
                role: user.role,
                email: user.email,
                isActive: user.isActive,
            },
            process.env.TOKEN_SECRET,
            {
                expiresIn: process.env.TOKEN_EXPIRATION
            }
        );

        res.cookie("login-token", accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            path: "/",
            sameSite: "strict",
        });

        return res.status(200).json({
            message: "Google authentication successful",
            token: accessToken,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                picture: user.picture,
                isActive: user.isActive

            }
        });
    } catch (error) {
        console.error("Google auth error:", error);
        return res.status(500).json({
            message: "Google authentication failed"
        });

    }

};

const login = async (req, res) => {
    try {
        const parsedData = loginSchema.parse(req.body);
        const user = await UserModel.findOne({ email: parsedData.email });
        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }
        if (!user.isVerified) {
            return res.status(401).json({ status: false, message: "Your account is not verified" });
        }
        const isMatch = await comparePassword(parsedData.password, user.password);
        if (!isMatch) {
            return res.status(401).json({
                message: "Invalid credentials"
            });
        }

        /* TOKEN GENERATION */

        const token = jwt.sign(
            {
                userId: user._id,
                role: user.role,
                email: user.email,
                phone: user.phone,
                isActive: user.isActive,
            },
            process.env.TOKEN_SECRET,
            { expiresIn: process.env.TOKEN_EXPIRATION }
        );

        res.cookie("login-token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            path: "/",
            sameSite: "strict",
        });

        return res.status(200).json({
            message: "Login successful",
            token,
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                phone: user.phone,
                isActive: user.isActive,
            },
        });

    } catch (error) {

        console.error("Login error:", error);

        return res.status(500).json({
            message: "Error logging in user"
        });

    }
};

const LogOut = async (req, res) => {
    try {
        const userId = req.user?._id;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const user = await UserModel.findById(userId);

        res.clearCookie("login-token", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
        });

        return res.status(200).json({
            message: "Logged out successfully",
        });
    } catch (error) {
        console.error("Logout error:", error);
        return res.status(500).json({
            message: "Internal server error",
        });
    }
};

const GetProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        console.log("User ID from token:", userId);
        const user = await UserModel.findById(userId).select("-password").select("-shiftType").select("-isActive");
        return res.status(200).json({ message: "User profile fetched successfully", user });
    } catch (error) {
        console.error("Error fetching user profile:", error);
        return res.status(500).json({ message: "Error fetching user profile", error });
    }
}

// Update Password
const updatePassword = async (req, res) => {
    try {
        const userId = req.user._id; // Get user ID from token
        const { oldPassword, newPassword, confirmPassword } = req.body;
        if (!oldPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({
                message: "All fields are required"
            });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({
                message: "New password should be at least 8 characters long"
            });
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                message: "Password do not match"
            });
        }
        const user = await UserModel.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        const isMatch = comparePassword(oldPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Old password is incorrect" });
        }
        const salt = bcrypt.genSaltSync(10);
        const hashedNewPassword = await bcrypt.hash(newPassword, salt);
        user.password = hashedNewPassword;
        await user.save();
        res.status(200).json({ success: true, message: "Password updated successfully" });
    } catch (error) {
        console.error("Error updating password:", error);
        res.status(500).json({ message: "Server error" });
    }
}

// Reset Password link 
const resetpasswordlink = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ status: false, message: "Email field is required" });
        }
        const user = await UserModel.findOne({ email });
        if (!user) {
            return res.status(404).json({ status: false, message: "Email doesn't exist" });
        }
        // Generate token for password reset
        const secret = user._id + process.env.TOKEN_SECRET;
        const token = jwt.sign({ userID: user._id }, secret, { expiresIn: process.env.TOKEN_EXPIRATION });
        console.log("My forget token...", token)
        // Reset Link and this link generate by frontend developer
        // FRONTEND_HOST_FORGETPASSWORD = http://localhost:3004/forgetpassword
        const resetLink = `${process.env.FRONTEND_URL}/${user._id}/${token}`;
        // Send password reset email  
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: "Password Reset Link",
            html: `<p>Hello ${user.name},</p><p>Please <a href="${resetLink}">Click here</a> to reset your password.</p>`
        });
        // Send success response
        res.status(200).json({ status: true, message: "Password reset email sent. Please check your email." });

    } catch (error) {
        console.log(error);
        res.status(500).json({ status: false, message: "Unable to send password reset email. Please try again later." });

    }

}

// Forget Password 
const forgetPassword = async (req, res) => {
    try {
        const { id, token } = req.params;
        const { password, confirmPassword } = req.body;
        const user = await UserModel.findById(id);
        if (!user) {
            return res.status(404).json({ status: false, message: "User not found" });
        }
        // Validate token check 
        const new_secret = user._id + process.env.TOKEN_SECRET;
        jwt.verify(token, new_secret);

        if (!password || !confirmPassword) {
            return res.status(400).json({ status: false, message: "New Password and Confirm New Password are required" });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({ status: false, message: "New Password and Confirm New Password don't match" });
        }
        // Generate salt and hash new password
        const salt = await bcrypt.genSalt(10);
        const newHashPassword = await bcrypt.hash(password, salt);

        // Update user's password
        await UserModel.findByIdAndUpdate(user._id, { $set: { password: newHashPassword } });

        // Send success response
        res.status(200).json({ status: "success", message: "Password reset successfully" });

    } catch (error) {
        console.log("Error updating password...", error)
        return res.status(500).json({ status: "failed", message: "Token expired or invalid" });
    }

}

module.exports = { login, GetProfile, LogOut, resetpasswordlink, forgetPassword, updatePassword, continueWithGoogle };

