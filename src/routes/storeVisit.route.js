const router = require("express").Router();
const verifyJwt = require("../middleware/verifiyUser.js");
const authorize = require("../middleware/authorize.js");
const {
  registerStoreVisit,
  getStoreVisitors,
  getVisitorDetails,
} = require("../controller/storeVisit.controller.js");

// mobile app (USER) store visit register kore
router.post("/", verifyJwt, authorize("USER"), registerStoreVisit);

// dashboard (STORE) visitors dekhe
router.get("/visitors", verifyJwt, authorize("STORE"), getStoreVisitors);
router.get(
  "/visitors/:visitId",
  verifyJwt,
  authorize("STORE"),
  getVisitorDetails,
);

module.exports = router;
