const router = require("express").Router();

const verifyJwt = require("../middleware/verifiyUser.js");
const authorize = require("../middleware/authorize.js");

const {
  checkout,
  getMyOrders,
  getMyOrdersByStore,
  getMyOrderById,
  cancelMyOrder,
  getStoreOrders,
  getStoreOrderById,
  updateOrderStatus,
} = require("../controller/order.controller.js");

// ---------- USER ----------
router.post("/checkout", verifyJwt, authorize("USER"), checkout);
router.get("/my-orders", verifyJwt, authorize("USER"), getMyOrders);
// "/by-store" obosshoi "/:orderId" er age, na hole "by-store" ke orderId dhore nibe
router.get("/my-orders/by-store", verifyJwt, authorize("USER"), getMyOrdersByStore);
router.get("/my-orders/:orderId", verifyJwt, authorize("USER"), getMyOrderById);
router.patch("/my-orders/:orderId/cancel", verifyJwt, authorize("USER"), cancelMyOrder);

// ---------- STORE ----------
router.get("/store-orders", verifyJwt, authorize("STORE"), getStoreOrders);
router.get("/store-orders/:orderId", verifyJwt, authorize("STORE"), getStoreOrderById);
router.patch("/store-orders/:orderId/status", verifyJwt, authorize("STORE"), updateOrderStatus);

module.exports = router;