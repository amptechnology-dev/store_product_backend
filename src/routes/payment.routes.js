const router = require("express").Router();
const verifyJwt = require("../middleware/verifiyUser.js");
const authorize = require("../middleware/authorize.js");
const {
  initiatePayment,
  payuCallback,
  verifyPayment,
  simulatePayment,
} = require("../controller/payment.controller.js");

// USER
router.post(
  "/initiate/:orderId",
  verifyJwt,
  authorize("USER"),
  initiatePayment,
);
router.get("/verify/:orderId", verifyJwt, authorize("USER"), verifyPayment);


router.post("/payu/success", payuCallback);
router.post("/payu/failure", payuCallback);

// testing purpose only
router.post(
  "/dev/simulate/:orderId",
  verifyJwt,
  authorize("USER"),
  simulatePayment,
);

module.exports = router;
