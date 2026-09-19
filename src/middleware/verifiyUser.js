const jwt = require("jsonwebtoken");
const  User  = require("../model/user.model.js");

const verifyJwt = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log("auth header", authHeader)

    const token =
      (authHeader?.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : null) ||
      req.cookies?.["login-token"]

    console.log("token, ", token)

    if (!token) {
      return res.status(401).json({ message: "Unauthorized request" });
    }

    console.log('==>', token)


    const decoded = jwt.verify(token, process.env.TOKEN_SECRET);


    const user = await User.findById(decoded.userId).select("-password");

    if (!user) {
      return res.status(401).json({ message: "Invalid token" });
    }


    req.user = user;
    req.userRole = user.role;

    next();
  } catch (error) {
    console.error("JWT error:", error);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

module.exports = verifyJwt;
