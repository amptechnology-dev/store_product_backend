const mongoose = require("mongoose");
const CartModel = require("../model/cart.model.js");
const OrderModel = require("../model/order.model.js");
const ProductModel = require("../model/product.model.js");
const StoreModel = require("../model/store.model.js");
const {
  ORDER_STATUSES,
  cartCheckoutSchema,
  directCheckoutSchema,
  cancelOrderSchema,
  updateOrderStatusSchema,
} = require("../schema/order.schema.js");
const {
  sendNewOrderEmailToStore,
  sendOrderConfirmationToUser,
  sendOrderStatusUpdateToUser,
} = require("../helper/orderMail.js");
const { notifyNewOrder } = require("../helper/notification.helper.js");
const { resolveLineSource } = require("../helper/resolveVariant.js");

// ===================== HELPERS =====================

const getUserId = (req) => req.user?._id || req.user?.id;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const escapeRegex = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getPagination = (query) => {
  const page = Math.max(parseInt(query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit) || 10, 1), 50);
  return { page, limit, skip: (page - 1) * limit };
};

const ALLOWED_FROM = {
  CONFIRMED: ["PENDING"],
  SHIPPED: ["CONFIRMED"],
  DELIVERED: ["SHIPPED"],
  CANCELLED: ["PENDING", "CONFIRMED"],
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
  if (error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: Object.values(error.errors).map((e) => ({
        field: e.path,
        message: e.message,
      })),
    });
  }
  console.error(`${label}:`, error);
  return res
    .status(500)
    .json({ success: false, message: "Internal server error" });
};

const parseStatus = (value) => {
  if (!value) return {};
  const status = String(value).toUpperCase();
  if (!ORDER_STATUSES.includes(status)) {
    return { error: `Invalid status. Allowed: ${ORDER_STATUSES.join(", ")}` };
  }
  return { status };
};

const getOwnedStoreIds = async (userId) => {
  const stores = await StoreModel.find({ userId }).select("_id").lean();
  return stores.map((s) => s._id);
};

const paginated = ({ page, limit, total, orders }) => ({
  success: true,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
  totalOrders: total,
  orders,
});

const getOrdersGroupedByStore = async (
  userId,
  { status, ordersPerStore = 5 } = {},
) => {
  const match = { userId: new mongoose.Types.ObjectId(String(userId)) };
  if (status) match.status = status;

  const stores = await OrderModel.aggregate([
    { $match: match },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $group: {
        _id: "$storeId",
        storeName: { $first: "$storeName" },
        storeUniqueId: { $first: "$storeUniqueId" },
        totalOrders: { $sum: 1 },
        totalSpent: {
          $sum: {
            $cond: [{ $eq: ["$status", "CANCELLED"] }, 0, "$totalAmount"],
          },
        },
        lastOrderAt: { $first: "$createdAt" },
        orders: {
          $push: {
            _id: "$_id",
            orderNumber: "$orderNumber",
            checkoutId: "$checkoutId",
            status: "$status",
            paymentStatus: "$paymentStatus",
            totalItems: "$totalItems",
            totalAmount: "$totalAmount",
            items: "$items",
            createdAt: "$createdAt",
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        storeId: "$_id",
        storeName: 1,
        storeUniqueId: 1,
        totalOrders: 1,
        totalSpent: 1,
        lastOrderAt: 1,
        orders: { $slice: ["$orders", ordersPerStore] },
      },
    },
    { $sort: { lastOrderAt: -1 } },
    { $limit: 50 },
  ]);

  return {
    totalStores: stores.length,
    totalOrders: stores.reduce((sum, s) => sum + s.totalOrders, 0),
    stores,
  };
};

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
    if (cart.items.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Your cart is empty" });
    }

    let selectedItems = cart.items;

    if (storeIds?.length) {
      const wanted = new Set(storeIds.map((id) => id.toLowerCase()));
      selectedItems = cart.items.filter((i) => wanted.has(String(i.storeId)));

      const inCart = new Set(selectedItems.map((i) => String(i.storeId)));
      const missing = [...wanted].filter((id) => !inCart.has(id));
      if (missing.length) {
        return res.status(400).json({
          success: false,
          message: "Some selected stores have no items in your cart",
          missingStoreIds: missing,
        });
      }
    }

    const selectedStoreIds = [
      ...new Set(selectedItems.map((i) => String(i.storeId))),
    ];

    const [stores, products] = await Promise.all([
      StoreModel.find({ _id: { $in: selectedStoreIds }, isActive: true })
        .select("storeName storeUniqueId email")
        .lean(),
      ProductModel.find({
        _id: { $in: selectedItems.map((i) => i.productId) },
        isActive: true,
        isVerified: true,
      })
        .select("storeId name productCode images unit variants mrp offerPrice")
        .lean(),
    ]);

    const storeMap = new Map(stores.map((s) => [String(s._id), s]));
    const productMap = new Map(products.map((p) => [String(p._id), p]));

    // item-er live product + live source (variant ba simple) ber kora
    const getLiveSource = (item) => {
      const p = productMap.get(String(item.productId));
      if (
        !p ||
        String(p.storeId) !== String(item.storeId) ||
        !storeMap.has(String(item.storeId))
      ) {
        return null;
      }
      const source = resolveLineSource(p, item.variantId);
      return source ? { product: p, source } : null;
    };

    const unavailableItems = [];
    const groups = new Map();

    for (const item of selectedItems) {
      const live = getLiveSource(item);
      if (!live) {
        unavailableItems.push({
          itemId: item._id,
          storeId: item.storeId,
          storeName: item.storeName ?? null,
          name: item.name,
        });
        continue;
      }

      const { product: p, source } = live;
      const key = String(item.storeId);
      const lineTotal = round2(source.offerPrice * item.quantity);

      if (!groups.has(key)) {
        groups.set(key, {
          storeId: item.storeId,
          items: [],
          totalItems: 0,
          totalMrp: 0,
          totalAmount: 0,
        });
      }
      const group = groups.get(key);

      group.items.push({
        productId: p._id,
        variantId: source.variantId,
        name: p.name,
        productCode: p.productCode,
        image: source.image,
        unit: p.unit,
        color: source.color,
        size: source.size,
        weight: source.weight,
        height: source.height,
        mrp: source.mrp,
        offerPrice: source.offerPrice,
        quantity: item.quantity,
        lineTotal,
      });
      group.totalItems += item.quantity;
      group.totalMrp += source.mrp * item.quantity;
      group.totalAmount += lineTotal;
    }

    if (unavailableItems.length) {
      return res.status(409).json({
        success: false,
        message:
          "Some items are no longer available. Remove them from your cart or order other stores only (storeIds).",
        unavailableItems,
      });
    }

    // ---- cart theke selected item atomically "claim" ----
    const removedItems = selectedItems.map((i) => i.toObject());

    const claim = await CartModel.updateOne(
      { _id: cart._id, updatedAt: cart.updatedAt },
      {
        $pull: {
          items: {
            storeId: {
              $in: selectedStoreIds.map(
                (id) => new mongoose.Types.ObjectId(id),
              ),
            },
          },
        },
      },
    );
    if (claim.modifiedCount === 0) {
      return res.status(409).json({
        success: false,
        message: "Your cart was just updated. Please review it and try again.",
      });
    }

    const checkoutId = new mongoose.Types.ObjectId();
    const orders = [];

    try {
      for (const group of groups.values()) {
        const store = storeMap.get(String(group.storeId));
        const totalMrp = round2(group.totalMrp);
        const totalAmount = round2(group.totalAmount);

        const order = await OrderModel.create({
          cartId: cart._id,
          checkoutId,
          userId,
          storeId: group.storeId,
          storeName: store.storeName,
          storeUniqueId: store.storeUniqueId,
          items: group.items,
          totalItems: group.totalItems,
          totalMrp,
          discount: round2(totalMrp - totalAmount),
          totalAmount,
          deliveryAddress,
          note: note || null,
          paymentMethod,
          status: "PENDING",
          statusHistory: [{ status: "PENDING", changedBy: userId }],
        });

        orders.push(order);
      }
    } catch (createError) {
      try {
        await OrderModel.deleteMany({ _id: { $in: orders.map((o) => o._id) } });
        await CartModel.updateOne(
          { _id: cart._id },
          { $push: { items: { $each: removedItems } } },
        );
      } catch (rollbackError) {
        console.error("Checkout rollback failed:", rollbackError);
      }
      throw createError;
    }

    for (const order of orders) {
      const store = storeMap.get(String(order.storeId));
      sendNewOrderEmailToStore({
        toEmail: store?.email,
        storeName: order.storeName,
        order,
      });
      notifyNewOrder(order);
    }
    sendOrderConfirmationToUser({
      toEmail: req.user?.email,
      userName: req.user?.name,
      orders,
    });

    return res.status(201).json({
      success: true,
      message:
        orders.length === 1
          ? "Order placed successfully"
          : `${orders.length} orders placed successfully (one per store)`,
      checkoutId,
      totalOrders: orders.length,
      grandTotal: round2(orders.reduce((sum, o) => sum + o.totalAmount, 0)),
      orders,
    });
  } catch (error) {
    return handleError(res, error, "Checkout Error");
  }
};

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
    })
      .select("storeId name productCode images unit variants mrp offerPrice")
      .lean();
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not available" });
    }

    const source = resolveLineSource(product, variantId);
    if (!source) {
      const hasVariants =
        Array.isArray(product.variants) && product.variants.length > 0;
      return res.status(400).json({
        success: false,
        message: hasVariants
          ? "Please select a valid size/weight/color option"
          : "This product is not available right now",
      });
    }

    const store = await StoreModel.findOne({
      _id: product.storeId,
      isActive: true,
    })
      .select("storeName storeUniqueId email")
      .lean();
    if (!store) {
      return res
        .status(400)
        .json({ success: false, message: "Store is currently unavailable" });
    }

    const totalMrp = round2(source.mrp * quantity);
    const totalAmount = round2(source.offerPrice * quantity);

    const order = await OrderModel.create({
      cartId: null, // cart chara direct order, tai cartId null thakbe
      checkoutId: new mongoose.Types.ObjectId(),
      userId,
      storeId: product.storeId,
      storeName: store.storeName,
      storeUniqueId: store.storeUniqueId,
      items: [
        {
          productId: product._id,
          variantId: source.variantId,
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
          quantity,
          lineTotal: totalAmount,
        },
      ],
      totalItems: quantity,
      totalMrp,
      discount: round2(totalMrp - totalAmount),
      totalAmount,
      deliveryAddress,
      note: note || null,
      paymentMethod,
      status: "PENDING",
      statusHistory: [{ status: "PENDING", changedBy: userId }],
    });

    sendNewOrderEmailToStore({
      toEmail: store?.email,
      storeName: order.storeName,
      order,
    });
    notifyNewOrder(order);
    sendOrderConfirmationToUser({
      toEmail: req.user?.email,
      userName: req.user?.name,
      orders: [order],
    });

    return res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order,
    });
  } catch (error) {
    return handleError(res, error, "Buy Now Error");
  }
};

// ===================== USER: MY ORDERS (flat list) =====================
const getMyOrders = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { page, limit, skip } = getPagination(req.query);

    const filter = { userId };

    const parsed = parseStatus(req.query.status);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }
    if (parsed.status) filter.status = parsed.status;

    const { storeId, checkoutId } = req.query;
    if (storeId) {
      if (!mongoose.isValidObjectId(storeId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid store id" });
      }
      filter.storeId = storeId;
    }
    if (checkoutId) {
      if (!mongoose.isValidObjectId(checkoutId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid checkout id" });
      }
      filter.checkoutId = checkoutId;
    }

    const [orders, total] = await Promise.all([
      OrderModel.find(filter)
        .select("-statusHistory -__v")
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      OrderModel.countDocuments(filter),
    ]);

    return res.status(200).json(paginated({ page, limit, total, orders }));
  } catch (error) {
    return handleError(res, error, "Get My Orders Error");
  }
};

// ===================== USER: MY ORDERS (store wise) =====================
const getMyOrdersByStore = async (req, res) => {
  try {
    const parsed = parseStatus(req.query.status);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }

    const ordersPerStore = Math.min(
      Math.max(parseInt(req.query.ordersPerStore) || 5, 1),
      20,
    );

    const result = await getOrdersGroupedByStore(getUserId(req), {
      status: parsed.status,
      ordersPerStore,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return handleError(res, error, "Get My Orders By Store Error");
  }
};

// ===================== USER: SINGLE ORDER =====================
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
    })
      .populate(
        "storeId",
        "storeName storeUniqueId contactNo whatsappNo address",
      )
      .lean();

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    return res.status(200).json({ success: true, order });
  } catch (error) {
    return handleError(res, error, "Get My Order Error");
  }
};

const cancelMyOrder = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { orderId } = req.params;
    if (!mongoose.isValidObjectId(orderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order id" });
    }

    const { reason } = cancelOrderSchema.parse(req.body);

    const order = await OrderModel.findOneAndUpdate(
      { _id: orderId, userId, status: { $in: ALLOWED_FROM.CANCELLED } },
      {
        $set: {
          status: "CANCELLED",
          cancelledBy: "USER",
          cancelReason: reason || null,
        },
        $push: {
          statusHistory: {
            status: "CANCELLED",
            changedBy: userId,
            note: reason || null,
            at: new Date(),
          },
        },
      },
      { new: true },
    ).lean();

    if (!order) {
      const exists = await OrderModel.exists({ _id: orderId, userId });
      if (!exists) {
        return res
          .status(404)
          .json({ success: false, message: "Order not found" });
      }
      return res.status(400).json({
        success: false,
        message: "This order can no longer be cancelled",
      });
    }

    sendOrderStatusUpdateToUser({
      toEmail: req.user?.email,
      userName: req.user?.name,
      order,
      status: "CANCELLED",
    });

    return res.status(200).json({
      success: true,
      message: "Order cancelled successfully",
      order,
    });
  } catch (error) {
    return handleError(res, error, "Cancel Order Error");
  }
};

// ===================== STORE: ORDER LIST =====================
const getStoreOrders = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { page, limit, skip } = getPagination(req.query);

    const ownedStoreIds = await getOwnedStoreIds(userId);
    if (!ownedStoreIds.length) {
      return res
        .status(200)
        .json(paginated({ page, limit, total: 0, orders: [] }));
    }

    const filter = { storeId: { $in: ownedStoreIds } };

    if (req.query.storeId) {
      const { storeId } = req.query;
      if (!mongoose.isValidObjectId(storeId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid store id" });
      }
      if (!ownedStoreIds.some((id) => String(id) === storeId)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      filter.storeId = storeId;
    }

    const parsed = parseStatus(req.query.status);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }
    if (parsed.status) filter.status = parsed.status;

    const search = String(req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      filter.$or = [
        { orderNumber: regex },
        { "deliveryAddress.fullName": regex },
        { "deliveryAddress.phone": regex },
      ];
    }

    const [orders, total] = await Promise.all([
      OrderModel.find(filter)
        .select("-statusHistory -__v")
        .populate("userId", "name email phone")
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      OrderModel.countDocuments(filter),
    ]);

    return res.status(200).json(paginated({ page, limit, total, orders }));
  } catch (error) {
    return handleError(res, error, "Get Store Orders Error");
  }
};

// ===================== STORE: SINGLE ORDER =====================
const getStoreOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!mongoose.isValidObjectId(orderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order id" });
    }

    const ownedStoreIds = await getOwnedStoreIds(getUserId(req));

    const order = await OrderModel.findOne({
      _id: orderId,
      storeId: { $in: ownedStoreIds },
    })
      .populate("userId", "name email phone")
      .lean();

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    return res.status(200).json({ success: true, order });
  } catch (error) {
    return handleError(res, error, "Get Store Order Error");
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { orderId } = req.params;
    if (!mongoose.isValidObjectId(orderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order id" });
    }

    const { status, note } = updateOrderStatusSchema.parse(req.body);
    const ownedStoreIds = await getOwnedStoreIds(userId);

    const set = { status };
    if (status === "DELIVERED") set.paymentStatus = "PAID";
    if (status === "CANCELLED") {
      set.cancelledBy = "STORE";
      set.cancelReason = note || null;
    }

    const order = await OrderModel.findOneAndUpdate(
      {
        _id: orderId,
        storeId: { $in: ownedStoreIds },
        status: { $in: ALLOWED_FROM[status] },
      },
      {
        $set: set,
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
    )
      .populate("userId", "name email")
      .lean();

    if (!order) {
      const current = await OrderModel.findOne({
        _id: orderId,
        storeId: { $in: ownedStoreIds },
      })
        .select("status")
        .lean();

      if (!current) {
        return res
          .status(404)
          .json({ success: false, message: "Order not found" });
      }
      return res.status(400).json({
        success: false,
        message: `Cannot change order status from ${current.status} to ${status}`,
      });
    }

    sendOrderStatusUpdateToUser({
      toEmail: order.userId?.email,
      userName: order.userId?.name,
      order,
      status,
    });

    return res.status(200).json({
      success: true,
      message: `Order marked as ${status}`,
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
  getOrdersGroupedByStore,
};
