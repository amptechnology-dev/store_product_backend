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

const getUserId = (req) => req.user?._id || req.user?.id;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

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
  return res.status(500).json({ success: false, message: "Internal server error" });
};

// ===================== INTERNAL HELPER =====================
// Ekta store-er ekta set-of-lines er jonno: stock atomically decrement kore,
// order banay. Kono ekta line fail korলে ager shob successful decrement
// rollback (restore) hoy — tai ekta store-er order "all or nothing".
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
    if (!source) {
      outOfStockLines.push({
        productId: line.productId,
        variantId: line.variantId,
        name: product.name,
        reason: "VARIANT_UNAVAILABLE",
      });
      continue;
    }

    const unit = locateStockUnit(product, line.variantId);
    if (!unit) {
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
        [source.color, source.size, source.weight, source.height].filter(Boolean).join(" / ") ||
        "Default",
      newStock: findUnitStock(result.product, unit.variantId, unit.sizeVariantId),
    });

    const lineTotal = round2(source.offerPrice * line.quantity);
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
      lineTotal,
    });
  }

  // ---------- kono line fail korলে shob decrement rollback ----------
  if (outOfStockLines.length > 0) {
    await Promise.all(
      decrementedLines.map((l) =>
        restoreStockForLine({
          productId: l.productId,
          variantId: l.variantId,
          sizeVariantId: l.sizeVariantId,
          quantity: l.quantity,
        }),
      ),
    );
    return { success: false, storeId, outOfStockLines };
  }

  // ---------- log successful decrements as SALE ----------
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

  const totalItems = orderItems.reduce((sum, i) => sum + i.quantity, 0);
  const totalMrp = round2(orderItems.reduce((sum, i) => sum + i.mrp * i.quantity, 0));
  const totalAmount = round2(orderItems.reduce((sum, i) => sum + i.lineTotal, 0));
  const discount = round2(totalMrp - totalAmount);

  const order = await OrderModel.create({
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

  return { success: true, storeId, order };
};

// ===================== INTERNAL: restore stock for every item of an order =====================
const restoreOrderStock = async (order, userId) => {
  await Promise.all(
    order.items.map(async (item) => {
      const product = await ProductModel.findById(item.productId).select("variants");
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
        const newStock = findUnitStock(restored, unit.variantId, unit.sizeVariantId);
        await logStockChange({
          productId: item.productId,
          storeId: order.storeId,
          userId,
          variantId: unit.variantId,
          sizeVariantId: unit.sizeVariantId,
          productName: item.name,
          variantLabel:
            [item.color, item.size, item.weight, item.height].filter(Boolean).join(" / ") ||
            "Default",
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
// body: { cartId, storeIds?, deliveryAddress, note?, paymentMethod }
const checkout = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { cartId, storeIds, deliveryAddress, note, paymentMethod } =
      cartCheckoutSchema.parse(req.body);

    const cart = await CartModel.findOne({ _id: cartId, userId });
    if (!cart) {
      return res.status(404).json({ success: false, message: "Cart not found" });
    }

    let items = cart.items;
    if (Array.isArray(storeIds) && storeIds.length > 0) {
      const storeIdSet = new Set(storeIds.map(String));
      items = items.filter((i) => storeIdSet.has(String(i.storeId)));
    }

    if (items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No items to checkout",
      });
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
    }

    // ---------- successful store-er item-gulo cart theke remove koro ----------
    if (successfulStoreIds.length > 0) {
      await CartModel.updateOne(
        { _id: cartId, userId },
        {
          $pull: {
            items: {
              storeId: { $in: successfulStoreIds.map((id) => new mongoose.Types.ObjectId(id)) },
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
// body: { productId, variantId?, quantity, deliveryAddress, note?, paymentMethod }
const buyNow = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { productId, variantId, quantity, deliveryAddress, note, paymentMethod } =
      directCheckoutSchema.parse(req.body);

    const product = await ProductModel.findOne({
      _id: productId,
      isActive: true,
      isVerified: true,
    });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not available" });
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
        message: "This item is out of stock",
        outOfStockLines: result.outOfStockLines,
      });
    }

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
    const { status, page = 1, limit = 10 } = req.query;

    const match = { userId };
    if (status) match.status = status;

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.max(parseInt(limit) || 10, 1);

    const [orders, totalOrders] = await Promise.all([
      OrderModel.find(match)
        .sort({ createdAt: -1 })
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
          orders: { $push: "$$ROOT" },
        },
      },
      { $sort: { "orders.0.createdAt": -1 } },
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
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const order = await OrderModel.findOne({ _id: orderId, userId: getUserId(req) }).lean();
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
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
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const { reason } = cancelOrderSchema.parse(req.body);

    const order = await OrderModel.findOne({ _id: orderId, userId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (["SHIPPED", "DELIVERED", "CANCELLED"].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Order cannot be cancelled once it is ${order.status}`,
      });
    }

    await restoreOrderStock(order, userId);

    order.status = "CANCELLED";
    order.cancelReason = reason || null;
    order.cancelledBy = "USER";
    order.statusHistory.push({
      status: "CANCELLED",
      changedBy: userId,
      note: reason || null,
      at: new Date(),
    });

    await order.save();

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
// GET /api/order/store-orders
const getStoreOrders = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { storeId, status, page = 1, limit = 10 } = req.query;

    const match = {};
    if (storeId) {
      if (!mongoose.isValidObjectId(storeId)) {
        return res.status(400).json({ success: false, message: "Invalid store id" });
      }
      match.storeId = storeId;
    } else {
      // storeId query-e na dile, ei STORE-user-er nijer shob store-er order dেখাও
      const myStores = await StoreModel.find({ userId }).select("_id").lean();
      match.storeId = { $in: myStores.map((s) => s._id) };
    }
    if (status) match.status = status;

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.max(parseInt(limit) || 10, 1);

    const [orders, totalOrders] = await Promise.all([
      OrderModel.find(match)
        .sort({ createdAt: -1 })
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
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const order = await OrderModel.findById(orderId).lean();
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // ownership check: eta ki ei STORE-user-er nijer store-er order?
    const store = await StoreModel.findOne({ _id: order.storeId, userId }).select("_id").lean();
    if (!store) {
      return res.status(403).json({ success: false, message: "Not authorized to view this order" });
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
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const { status, note } = updateOrderStatusSchema.parse(req.body);

    const order = await OrderModel.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // ownership check
    const store = await StoreModel.findOne({ _id: order.storeId, userId }).select("_id").lean();
    if (!store) {
      return res.status(403).json({ success: false, message: "Not authorized to update this order" });
    }

    if (order.status === "CANCELLED" || order.status === "DELIVERED") {
      return res.status(400).json({
        success: false,
        message: `Order status cannot be changed once it is ${order.status}`,
      });
    }

    // ---------- store CANCELLED korলে stock restore koro ----------
    if (status === "CANCELLED") {
      await restoreOrderStock(order, userId);
      order.cancelReason = note || null;
      order.cancelledBy = "STORE";
    }

    order.status = status;
    order.statusHistory.push({ status, changedBy: userId, note: note || null, at: new Date() });

    await order.save();

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