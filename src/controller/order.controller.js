const mongoose = require("mongoose");
const CartModel = require("../model/cart.model.js");
const OrderModel = require("../model/order.model.js");
const ProductModel = require("../model/product.model.js");
const StoreModel = require("../model/store.model.js");
const {
  cartCheckoutSchema,
  directCheckoutSchema,
  cancelOrderSchema,
  updateOrderStatusSchema,
} = require("../schema/order.schema.js");
const { resolveLineSource } = require("../helper/resolveVariant.js");
const {
  locateStockUnit,
  decrementStockForLine,
  restoreStockForLine,
  logStockChange,
  findUnitStock,
} = require("../helper/stockManager.js");
const { notifyNewOrder } = require("../helper/notification.helper.js");

// ===================== CONSTANTS / HELPERS =====================
const ORDER_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
];

// frontend er getNextStatuses er sathe mil rakho
const ALLOWED_TRANSITIONS = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

const CUSTOMER_FIELDS = "name phone email";
const MAX_LIMIT = 100;

const getUserId = (req) => req.user?._id || req.user?.id;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parsePagination = (query) => {
  const pageNum = Math.max(parseInt(query.page) || 1, 1);
  const limitNum = Math.min(
    Math.max(parseInt(query.limit) || 10, 1),
    MAX_LIMIT,
  );
  return { pageNum, limitNum };
};

const handleError = (res, error, label) => {
  if (error.name === "ZodError") {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: error.issues.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      })),
    });
  }
  console.error(`${label}:`, error);
  return res
    .status(500)
    .json({ success: false, message: "Internal server error" });
};

// Ei STORE-user er nijer shob store er id
const getOwnedStoreIds = async (userId) => {
  const stores = await StoreModel.find({ userId }).select("_id").lean();
  return stores.map((s) => s._id);
};

const isStoreOwner = async (storeId, userId) =>
  !!(await StoreModel.exists({ _id: storeId, userId }));

// Atomic status change: sudhu valid "from" status thakle-i update hoy.
// Concurrent request e ekta-i jitbe, tai stock double restore hobe na.
const transitionOrder = async ({
  orderId,
  filter = {},
  status,
  note,
  userId,
  extra = {},
  populateUser = false,
}) => {
  const validFrom = ORDER_STATUSES.filter((s) =>
    ALLOWED_TRANSITIONS[s].includes(status),
  );

  let query = OrderModel.findOneAndUpdate(
    { _id: orderId, ...filter, status: { $in: validFrom } },
    {
      $set: { status, ...extra },
      $push: {
        statusHistory: {
          status,
          changedBy: userId,
          note: note || null,
          at: new Date(),
        },
      },
    },
    { new: true },
  );
  if (populateUser) query = query.populate("userId", CUSTOMER_FIELDS);
  return query.lean();
};

const rollbackLines = (lines) =>
  Promise.all(
    lines.map((l) =>
      restoreStockForLine({
        productId: l.productId,
        variantId: l.variantId,
        sizeVariantId: l.sizeVariantId,
        quantity: l.quantity,
      }),
    ),
  );

// ===================== INTERNAL HELPER =====================
// Ekta store er ekta set-of-lines er jonno: stock atomically decrement kore,
// order banay. Kono ekta line fail korle ager shob decrement rollback hoy —
// tai ekta store er order "all or nothing".
const attemptStoreCheckout = async ({
  userId,
  storeId,
  lines, // [{ productId, variantId (unitId or null), quantity }]
  deliveryAddress,
  note,
  paymentMethod,
}) => {
  const store = await StoreModel.findOne({ _id: storeId, isActive: true })
    .select("storeName storeUniqueId")
    .lean();
  if (!store) {
    return { success: false, storeId, message: "Store not found or inactive" };
  }

  const productIds = [...new Set(lines.map((l) => String(l.productId)))];
  const products = await ProductModel.find({
    _id: { $in: productIds },
    isActive: true,
    isVerified: true,
  });
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  const orderItems = [];
  const decrementedLines = [];
  const outOfStockLines = [];

  for (const line of lines) {
    const product = productMap.get(String(line.productId));
    if (!product) {
      outOfStockLines.push({
        productId: line.productId,
        variantId: line.variantId,
        reason: "PRODUCT_UNAVAILABLE",
      });
      continue;
    }

    const source = resolveLineSource(product, line.variantId);
    const unit = source ? locateStockUnit(product, line.variantId) : null;
    if (!source || !unit) {
      outOfStockLines.push({
        productId: line.productId,
        variantId: line.variantId,
        name: product.name,
        reason: "VARIANT_UNAVAILABLE",
      });
      continue;
    }

    const result = await decrementStockForLine({
      productId: product._id,
      variantId: unit.variantId,
      sizeVariantId: unit.sizeVariantId,
      quantity: line.quantity,
    });

    if (!result.success) {
      outOfStockLines.push({
        productId: line.productId,
        variantId: line.variantId,
        name: product.name,
        availableStock: unit.currentStock,
        requestedQuantity: line.quantity,
        reason: "INSUFFICIENT_STOCK",
      });
      continue;
    }

    decrementedLines.push({
      productId: product._id,
      storeId: product.storeId,
      variantId: unit.variantId,
      sizeVariantId: unit.sizeVariantId,
      quantity: line.quantity,
      productName: product.name,
      variantLabel:
        [source.color, source.size, source.weight, source.height]
          .filter(Boolean)
          .join(" / ") || "Default",
      newStock: findUnitStock(
        result.product,
        unit.variantId,
        unit.sizeVariantId,
      ),
    });

    orderItems.push({
      productId: product._id,
      variantId: line.variantId ?? null,
      name: product.name,
      productCode: product.productCode,
      image: source.image,
      unit: product.unit,
      color: source.color,
      size: source.size,
      weight: source.weight,
      height: source.height,
      mrp: source.mrp,
      offerPrice: source.offerPrice,
      quantity: line.quantity,
      lineTotal: round2(source.offerPrice * line.quantity),
    });
  }

  // ---------- kono line fail korle shob decrement rollback ----------
  if (outOfStockLines.length > 0) {
    await rollbackLines(decrementedLines);
    return { success: false, storeId, outOfStockLines };
  }

  const totalItems = orderItems.reduce((sum, i) => sum + i.quantity, 0);
  const totalMrp = round2(
    orderItems.reduce((sum, i) => sum + i.mrp * i.quantity, 0),
  );
  const totalAmount = round2(
    orderItems.reduce((sum, i) => sum + i.lineTotal, 0),
  );
  const discount = round2(totalMrp - totalAmount);

  // ---------- order create fail korle stock ferot dao ----------
  let order;
  try {
    order = await OrderModel.create({
      userId,
      storeId,
      storeName: store.storeName,
      storeUniqueId: store.storeUniqueId,
      items: orderItems,
      totalItems,
      totalMrp,
      discount,
      totalAmount,
      deliveryAddress,
      note,
      paymentMethod,
      status: "PENDING",
      statusHistory: [{ status: "PENDING", changedBy: userId, at: new Date() }],
    });
  } catch (err) {
    await rollbackLines(decrementedLines);
    throw err;
  }

  // ---------- order confirm hoyeche, ekhon SALE log koro ----------
  await Promise.all(
    decrementedLines.map((l) =>
      logStockChange({
        productId: l.productId,
        storeId: l.storeId,
        userId,
        variantId: l.variantId,
        sizeVariantId: l.sizeVariantId,
        productName: l.productName,
        variantLabel: l.variantLabel,
        type: "OUT",
        reason: "SALE",
        previousStock: l.newStock + l.quantity,
        newStock: l.newStock,
      }),
    ),
  );

  return { success: true, storeId, order };
};

// ===================== INTERNAL: restore stock for every item of an order =====================
const restoreOrderStock = async (order, userId) => {
  await Promise.all(
    order.items.map(async (item) => {
      const product = await ProductModel.findById(item.productId).select(
        "variants",
      );
      if (!product) return;

      const unit = locateStockUnit(product, item.variantId);
      if (!unit) return;

      const restored = await restoreStockForLine({
        productId: item.productId,
        variantId: unit.variantId,
        sizeVariantId: unit.sizeVariantId,
        quantity: item.quantity,
      });

      if (restored) {
        const newStock = findUnitStock(
          restored,
          unit.variantId,
          unit.sizeVariantId,
        );
        await logStockChange({
          productId: item.productId,
          storeId: order.storeId,
          userId,
          variantId: unit.variantId,
          sizeVariantId: unit.sizeVariantId,
          productName: item.name,
          variantLabel:
            [item.color, item.size, item.weight, item.height]
              .filter(Boolean)
              .join(" / ") || "Default",
          type: "IN",
          reason: "OTHER",
          note: `Order ${order.orderNumber} cancelled`,
          previousStock: newStock - item.quantity,
          newStock,
        });
      }
    }),
  );
};

// ===================== 1. CHECKOUT FROM CART (multi-store) =====================
// POST /api/order/checkout
const checkout = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { cartId, storeIds, deliveryAddress, note, paymentMethod } =
      cartCheckoutSchema.parse(req.body);

    const cart = await CartModel.findOne({ _id: cartId, userId });
    if (!cart) {
      return res
        .status(404)
        .json({ success: false, message: "Cart not found" });
    }

    let items = cart.items;
    if (Array.isArray(storeIds) && storeIds.length > 0) {
      const storeIdSet = new Set(storeIds.map(String));
      items = items.filter((i) => storeIdSet.has(String(i.storeId)));
    }

    if (items.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No items to checkout" });
    }

    // ---------- store wise group ----------
    const groups = new Map();
    for (const item of items) {
      const key = String(item.storeId);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
      });
    }

    const createdOrders = [];
    const failedStores = [];
    const successfulStoreIds = [];

    // ---------- protyek store independently checkout hoy ----------
    for (const [storeId, lines] of groups.entries()) {
      try {
        const result = await attemptStoreCheckout({
          userId,
          storeId,
          lines,
          deliveryAddress,
          note,
          paymentMethod,
        });

        if (result.success) {
          createdOrders.push(result.order);
          successfulStoreIds.push(storeId);
        } else {
          failedStores.push({
            storeId,
            message: result.message,
            outOfStockLines: result.outOfStockLines,
          });
        }
      } catch (err) {
        // ekta store e unexpected error hole baki store der jeno atke na jay
        console.error(`Checkout failed for store ${storeId}:`, err);
        failedStores.push({
          storeId,
          message: "Could not place order for this store",
        });
      }
    }

    // ---------- successful store er item gulo cart theke remove ----------
    if (successfulStoreIds.length > 0) {
      await CartModel.updateOne(
        { _id: cartId, userId },
        {
          $pull: {
            items: {
              storeId: {
                $in: successfulStoreIds.map(
                  (id) => new mongoose.Types.ObjectId(id),
                ),
              },
            },
          },
        },
      );
    }

    if (createdOrders.length === 0) {
      return res.status(409).json({
        success: false,
        message: "Checkout failed for all stores",
        failedStores,
      });
    }

    if (createdOrders.length === 0) {
      return res.status(409).json({
        success: false,
        message: "Checkout failed for all stores",
        failedStores,
      });
    }
    for (const order of createdOrders) {
      notifyNewOrder(order);
    }

    return res.status(201).json({
      success: true,
      message:
        failedStores.length > 0
          ? "Order placed for some stores; others could not be completed"
          : "Order(s) placed successfully",
      orders: createdOrders,
      failedStores: failedStores.length > 0 ? failedStores : undefined,
    });
  } catch (error) {
    return handleError(res, error, "Checkout Error");
  }
};

// ===================== 2. DIRECT "BUY NOW" CHECKOUT =====================
// POST /api/order/buy-now
const buyNow = async (req, res) => {
  try {
    const userId = getUserId(req);
    const {
      productId,
      variantId,
      quantity,
      deliveryAddress,
      note,
      paymentMethod,
    } = directCheckoutSchema.parse(req.body);

    const product = await ProductModel.findOne({
      _id: productId,
      isActive: true,
      isVerified: true,
    });
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not available" });
    }

    const result = await attemptStoreCheckout({
      userId,
      storeId: product.storeId,
      lines: [{ productId, variantId: variantId || null, quantity }],
      deliveryAddress,
      note,
      paymentMethod,
    });

    if (!result.success) {
      return res.status(409).json({
        success: false,
        message: result.message || "This item is out of stock",
        outOfStockLines: result.outOfStockLines,
      });
    }

    notifyNewOrder(result.order);

    return res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order: result.order,
    });
  } catch (error) {
    return handleError(res, error, "Buy Now Error");
  }
};

// ===================== 3. GET MY ORDERS (flat list) =====================
// GET /api/order/my-orders
const getMyOrders = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { status } = req.query;

    if (status && !ORDER_STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    const match = { userId };
    if (status) match.status = status;

    const { pageNum, limitNum } = parsePagination(req.query);

    const [orders, totalOrders] = await Promise.all([
      OrderModel.find(match)
        .sort({ createdAt: -1, _id: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      OrderModel.countDocuments(match),
    ]);

    return res.status(200).json({
      success: true,
      page: pageNum,
      limit: limitNum,
      totalOrders,
      totalPages: Math.ceil(totalOrders / limitNum),
      orders,
    });
  } catch (error) {
    return handleError(res, error, "Get My Orders Error");
  }
};

// ===================== 4. GET MY ORDERS GROUPED BY STORE =====================
// GET /api/order/my-orders/by-store
const getMyOrdersByStore = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { status } = req.query;

    if (status && !ORDER_STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    const match = { userId: new mongoose.Types.ObjectId(userId) };
    if (status) match.status = status;

    const grouped = await OrderModel.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$storeId",
          storeName: { $first: "$storeName" },
          storeUniqueId: { $first: "$storeUniqueId" },
          totalOrders: { $sum: 1 },
          latestOrderAt: { $max: "$createdAt" },
          orders: { $push: "$$ROOT" },
        },
      },
      { $sort: { latestOrderAt: -1 } },
    ]);

    return res.status(200).json({
      success: true,
      count: grouped.length,
      stores: grouped.map((g) => ({
        storeId: g._id,
        storeName: g.storeName,
        storeUniqueId: g.storeUniqueId,
        totalOrders: g.totalOrders,
        orders: g.orders,
      })),
    });
  } catch (error) {
    return handleError(res, error, "Get My Orders By Store Error");
  }
};

// ===================== 5. GET SINGLE ORDER (user side) =====================
// GET /api/order/my-orders/:orderId
const getMyOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!mongoose.isValidObjectId(orderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order id" });
    }

    const order = await OrderModel.findOne({
      _id: orderId,
      userId: getUserId(req),
    }).lean();
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    return res.status(200).json({ success: true, order });
  } catch (error) {
    return handleError(res, error, "Get My Order By Id Error");
  }
};

// ===================== 6. CANCEL ORDER (user side) — stock restore hoy =====================
// PATCH /api/order/my-orders/:orderId/cancel   body: { reason? }
const cancelMyOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = getUserId(req);

    if (!mongoose.isValidObjectId(orderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order id" });
    }

    const { reason } = cancelOrderSchema.parse(req.body);

    const existing = await OrderModel.findOne({ _id: orderId, userId })
      .select("status")
      .lean();
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    if (!ALLOWED_TRANSITIONS[existing.status].includes("CANCELLED")) {
      return res.status(400).json({
        success: false,
        message: `Order cannot be cancelled once it is ${existing.status}`,
      });
    }

    // atomic claim: ekta request-i jitbe, tai stock ekbar-i restore hobe
    const order = await transitionOrder({
      orderId,
      filter: { userId },
      status: "CANCELLED",
      note: reason,
      userId,
      extra: { cancelReason: reason || null, cancelledBy: "USER" },
    });

    if (!order) {
      return res.status(409).json({
        success: false,
        message: "Order status has just changed, please refresh",
      });
    }

    await restoreOrderStock(order, userId);

    return res.status(200).json({
      success: true,
      message: "Order cancelled and stock restored",
      order,
    });
  } catch (error) {
    return handleError(res, error, "Cancel My Order Error");
  }
};

// ===================== 7. STORE SIDE: GET STORE ORDERS =====================
// GET /api/order/store-orders?page&limit&status&search&storeId
const getStoreOrders = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { storeId, status } = req.query;
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    if (status && !ORDER_STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    // ---------- shudhu nijer store er order ----------
    const ownedStoreIds = await getOwnedStoreIds(userId);
    const match = {};

    if (storeId) {
      if (!mongoose.isValidObjectId(storeId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid store id" });
      }
      if (!ownedStoreIds.some((id) => String(id) === String(storeId))) {
        return res
          .status(403)
          .json({ success: false, message: "Not authorized for this store" });
      }
      match.storeId = storeId;
    } else {
      match.storeId = { $in: ownedStoreIds };
    }

    if (status) match.status = status;

    // ---------- search: order # / customer name, phone, email / delivery name, phone ----------
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      const UserModel = mongoose.model("User");
      const users = await UserModel.find({
        $or: [{ name: rx }, { phone: rx }, { email: rx }],
      })
        .select("_id")
        .limit(200)
        .lean();

      match.$or = [
        { orderNumber: rx },
        { "deliveryAddress.fullName": rx },
        { "deliveryAddress.phone": rx },
        ...(users.length ? [{ userId: { $in: users.map((u) => u._id) } }] : []),
      ];
    }

    const { pageNum, limitNum } = parsePagination(req.query);

    const [orders, totalOrders] = await Promise.all([
      OrderModel.find(match)
        .populate("userId", CUSTOMER_FIELDS)
        .sort({ createdAt: -1, _id: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      OrderModel.countDocuments(match),
    ]);

    return res.status(200).json({
      success: true,
      page: pageNum,
      limit: limitNum,
      totalOrders,
      totalPages: Math.ceil(totalOrders / limitNum),
      orders,
    });
  } catch (error) {
    return handleError(res, error, "Get Store Orders Error");
  }
};

// ===================== 8. STORE SIDE: GET SINGLE ORDER =====================
// GET /api/order/store-orders/:orderId
const getStoreOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = getUserId(req);

    if (!mongoose.isValidObjectId(orderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order id" });
    }

    const order = await OrderModel.findById(orderId)
      .populate("userId", CUSTOMER_FIELDS)
      .lean();
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    if (!(await isStoreOwner(order.storeId, userId))) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized to view this order" });
    }

    return res.status(200).json({ success: true, order });
  } catch (error) {
    return handleError(res, error, "Get Store Order By Id Error");
  }
};

// ===================== 9. UPDATE ORDER STATUS (store side) =====================
// PATCH /api/order/store-orders/:orderId/status   body: { status, note? }
const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = getUserId(req);

    if (!mongoose.isValidObjectId(orderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order id" });
    }

    const { status, note } = updateOrderStatusSchema.parse(req.body);

    const existing = await OrderModel.findById(orderId)
      .select("storeId status")
      .lean();
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    if (!(await isStoreOwner(existing.storeId, userId))) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this order",
      });
    }

    if (!ALLOWED_TRANSITIONS[existing.status].includes(status)) {
      return res.status(400).json({
        success: false,
        message:
          ALLOWED_TRANSITIONS[existing.status].length === 0
            ? `Order status cannot be changed once it is ${existing.status}`
            : `Cannot change status from ${existing.status} to ${status}`,
      });
    }

    const extra = {};
    if (status === "CANCELLED") {
      extra.cancelReason = note || null;
      extra.cancelledBy = "STORE";
    }
    if (status === "DELIVERED") {
      extra.paymentStatus = "PAID"; // COD: delivery te taka pawa jay
    }

    const order = await transitionOrder({
      orderId,
      status,
      note,
      userId,
      extra,
      populateUser: true, // frontend merge e customer jeno na hariye jay
    });

    if (!order) {
      return res.status(409).json({
        success: false,
        message: "Order status has just changed, please refresh",
      });
    }

    if (status === "CANCELLED") {
      await restoreOrderStock(order, userId);
    }

    return res.status(200).json({
      success: true,
      message: "Order status updated",
      order,
    });
  } catch (error) {
    return handleError(res, error, "Update Order Status Error");
  }
};

module.exports = {
  checkout,
  buyNow,
  getMyOrders,
  getMyOrdersByStore,
  getMyOrderById,
  cancelMyOrder,
  getStoreOrders,
  getStoreOrderById,
  updateOrderStatus,
};
