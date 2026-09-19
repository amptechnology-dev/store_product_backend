const router = require("express").Router();

const { login, GetProfile, LogOut, resetpasswordlink, forgetPassword, updatePassword,continueWithGoogle } = require("../controller/login.controller.js");
const verifyJwt = require("../middleware/verifiyUser.js");
const { uploadStudentImages } = require("../middleware/multiMulter.js")

router.post("/", login);
router.get("/profile-page", verifyJwt, GetProfile);
router.post("/logout", verifyJwt, LogOut);
router.post("/reset-password-link", resetpasswordlink);
router.post("/forget-password/:id/:token", forgetPassword);
router.post("/update-password", verifyJwt, updatePassword);
router.post("/continue-with-google", continueWithGoogle);
module.exports = router;