const router = require("express").Router();

const verifyJwt = require("../middleware/verifiyUser.js");
const authorize = require("../middleware/authorize.js");

const {
  saveDeliverySettings,
  getDeliverySettings,
  previewServicePincodes,
  checkDelivery,
  lookupPincode,
  getMyPincode,
} = require("../controller/delivery.controller.js");

// ---------- STORE ----------
router.put("/settings", verifyJwt, authorize("STORE"), saveDeliverySettings);
router.get(
  "/settings/:storeId",
  verifyJwt,
  authorize("STORE"),
  getDeliverySettings,
);
router.get(
  "/settings/:storeId/service-pincodes",
  verifyJwt,
  authorize("STORE"),
  previewServicePincodes,
);

// ---------- USER ----------
router.get("/my-pincode", verifyJwt, authorize("USER"), getMyPincode);

// ---------- PUBLIC (user app / storefront) ----------
router.get("/check", checkDelivery);
router.get("/pincode/:pincode", lookupPincode);

module.exports = router;