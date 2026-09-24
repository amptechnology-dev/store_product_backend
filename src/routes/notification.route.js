const router = require("express").Router();
const verifyJwt = require("../middleware/verifiyUser.js");
const authorize = require("../middleware/authorize.js");
const {
  saveFcmToken,
  getNotifications,
  markNotificationsRead,
} = require("../controller/notification.controller.js");

router.post("/fcm-token", verifyJwt, authorize("STORE"), saveFcmToken);
router.get("/", verifyJwt, authorize("STORE"), getNotifications);
router.patch("/read", verifyJwt, authorize("STORE"), markNotificationsRead);

module.exports = router;