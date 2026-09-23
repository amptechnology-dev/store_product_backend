const mongoose = require("mongoose");
const CartModel = require("../model/cart.model.js");
const ProductModel = require("../model/product.model.js");
const StoreModel = require("../model/store.model.js");
const {
  addToCartSchema,
  updateCartItemSchema,
  MAX_ITEM_QUANTITY,
  MAX_CART_LINES,
} = require("../schema/cart.schema.js");

// ===================== HELPERS =====================

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
  if (error.name === "VersionError") {
    return res.status(409).json({
      success: false,
      message: "Your cart was updated by another request. Please try again.",
    });
  }
  console.error(`${label}:`, error);
  return res.status(500).json({ success: false, message: "Internal server error" });
};

// product-er variants array theke ekta specific active variant khoja
const findActiveVariant = (product, variantId) =>
  (product?.variants || []).find(
    (v) => String(v._id) === String(variantId) && v.isActive !== false,
  );

const toSnapshot = (product, variant) => ({
  name: product.name,
  productCode: product.productCode,
  image: product.images?.[0] ?? null,
  unit: product.unit,
  size: variant.size ?? null,
  weight: variant.weight ?? null,
  mrp: variant.mrp,
  offerPrice: variant.offerPrice,
});

const newSummary = () => ({
  totalItems: 0,
  totalMrp: 0,
  discount: 0,
  totalAmount: 0,
  hasUnavailableItems: false,
});

const finalizeSummary = (s) => {
  s.totalMrp = round2(s.totalMrp);
  s.totalAmount = round2(s.totalAmount);
  s.discount = round2(s.totalMrp - s.totalAmount);
  return s;
};

// cart ke store wise group kore live product+variant data shoho response banay
const serializeCart = async (cart) => {
  if (!cart || cart.items.length === 0) {
    return {
      _id: cart?._id ?? null,
      stores: [],
      summary: { ...newSummary(), totalStores: 0 },
    };
  }

  const productIds = [...new Set(cart.items.map((i) => String(i.productId)))];
  const storeIds = [...new Set(cart.items.map((i) => String(i.storeId)))];

  const [products, stores] = await Promise.all([
    ProductModel.find({ _id: { $in: productIds } })
      .select("name productCode images unit variants isActive isVerified")
      .lean(),
    StoreModel.find({ _id: { $in: storeIds } })
      .select("storeName storeUniqueId images isActive")
      .lean(),
  ]);

  const productMap = new Map(products.map((p) => [String(p._id), p]));
  const storeMap = new Map(stores.map((s) => [String(s._id), s]));

  const overall = newSummary();
  const groups = new Map();

  for (const item of cart.items) {
    const storeKey = String(item.storeId);
    const store = storeMap.get(storeKey);

    if (!groups.has(storeKey)) {
      groups.set(storeKey, {
        store: {
          _id: item.storeId,
          storeName: store?.storeName ?? item.storeName ?? null,
          storeUniqueId: store?.storeUniqueId ?? null,
          image: store?.images?.[0] ?? null,
          isActive: Boolean(store?.isActive),
        },
        items: [],
        summary: newSummary(),
      });
    }
    const group = groups.get(storeKey);

    const liveProduct = productMap.get(String(item.productId));
    const liveVariant = liveProduct ? findActiveVariant(liveProduct, item.variantId) : null;
    const isAvailable = Boolean(
      liveProduct?.isActive && liveProduct?.isVerified && liveVariant && store?.isActive,
    );

    const mrp = isAvailable ? liveVariant.mrp : item.mrp;
    const offerPrice = isAvailable ? liveVariant.offerPrice : item.offerPrice;
    const lineTotal = round2(offerPrice * item.quantity);

    for (const s of [group.summary, overall]) {
      if (isAvailable) {
        s.totalItems += item.quantity;
        s.totalMrp += mrp * item.quantity;
        s.totalAmount += lineTotal;
      } else {
        s.hasUnavailableItems = true;
      }
    }

    group.items.push({
      _id: item._id,
      productId: item.productId,
      variantId: item.variantId,
      name: isAvailable ? liveProduct.name : item.name,
      productCode: isAvailable ? liveProduct.productCode : item.productCode,
      image: isAvailable ? (liveProduct.images?.[0] ?? null) : (item.image ?? null),
      unit: isAvailable ? liveProduct.unit : item.unit,
      size: isAvailable ? liveVariant.size : item.size,
      weight: isAvailable ? liveVariant.weight : item.weight,
      quantity: item.quantity,
      mrp,
      offerPrice,
      lineTotal,
      isAvailable,
      priceChanged: isAvailable && liveVariant.offerPrice !== item.offerPrice,
      stock: isAvailable ? liveVariant.stock : undefined,
    });
  }

  const storeGroups = [...groups.values()].map((g) => ({
    ...g,
    summary: finalizeSummary(g.summary),
  }));

  return {
    _id: cart._id,
    stores: storeGroups,
    summary: { ...finalizeSummary(overall), totalStores: storeGroups.length },
  };
};

// ===================== 1. ADD TO CART =====================
// POST /cart/add
// body: { productId, variantId, quantity? }
const addToCart = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { productId, variantId, quantity } = addToCartSchema.parse(req.body);

    const product = await ProductModel.findOne({
      _id: productId,
      isActive: true,
      isVerified: true,
    }).lean();
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not available" });
    }

    const variant = findActiveVariant(product, variantId);
    if (!variant) {
      return res
        .status(404)
        .json({ success: false, message: "Selected size/weight is not available" });
    }

    const store = await StoreModel.findOne({ _id: product.storeId, isActive: true })
      .select("storeName")
      .lean();
    if (!store) {
      return res.status(400).json({ success: false, message: "Store is currently unavailable" });
    }

    const cart = await CartModel.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { upsert: true, new: true },
    );

    // ✅ same product + SAME variant hole ek line, kintu same product +
    // ALADA variant (jemon Large ar Small) hole alada alada cart line hobe
    const existing = cart.items.find(
      (i) =>
        String(i.productId) === String(product._id) &&
        String(i.variantId) === String(variant._id),
    );

    const newQuantity = (existing?.quantity ?? 0) + quantity;
    if (newQuantity > MAX_ITEM_QUANTITY) {
      return res.status(400).json({
        success: false,
        message: `You can add at most ${MAX_ITEM_QUANTITY} units of a single item`,
      });
    }

    if (!existing && cart.items.length >= MAX_CART_LINES) {
      return res.status(400).json({
        success: false,
        message: `Your cart can hold at most ${MAX_CART_LINES} different items`,
      });
    }

    const snapshot = toSnapshot(product, variant);

    if (existing) {
      existing.set({ ...snapshot, storeName: store.storeName, quantity: newQuantity });
    } else {
      cart.items.push({
        productId: product._id,
        variantId: variant._id,
        storeId: product.storeId,
        storeName: store.storeName,
        quantity,
        ...snapshot,
      });
    }

    await cart.save();

    return res.status(200).json({
      success: true,
      message: "Added to cart",
      cart: await serializeCart(cart),
    });
  } catch (error) {
    return handleError(res, error, "Add To Cart Error");
  }
};

// ===================== 2. GET CART (store wise) =====================
const getCart = async (req, res) => {
  try {
    const cart = await CartModel.findOne({ userId: getUserId(req) });
    return res.status(200).json({ success: true, cart: await serializeCart(cart) });
  } catch (error) {
    return handleError(res, error, "Get Cart Error");
  }
};

// ===================== 3. UPDATE ITEM QUANTITY =====================
const updateCartItem = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { itemId } = req.params;

    if (!mongoose.isValidObjectId(itemId)) {
      return res.status(400).json({ success: false, message: "Invalid item id" });
    }

    const { quantity } = updateCartItemSchema.parse(req.body);

    const cart = await CartModel.findOne({ userId });
    const item = cart?.items.id(itemId);
    if (!item) {
      return res.status(404).json({ success: false, message: "Cart item not found" });
    }

    const product = await ProductModel.findOne({
      _id: item.productId,
      isActive: true,
      isVerified: true,
    }).lean();

    const variant = product ? findActiveVariant(product, item.variantId) : null;

    if (!product || !variant) {
      return res.status(400).json({
        success: false,
        message: "This product is no longer available. Please remove it from your cart.",
      });
    }

    item.set({ ...toSnapshot(product, variant), quantity });
    await cart.save();

    return res.status(200).json({
      success: true,
      message: "Cart updated",
      cart: await serializeCart(cart),
    });
  } catch (error) {
    return handleError(res, error, "Update Cart Item Error");
  }
};

// ===================== 4. REMOVE ITEM =====================
const removeCartItem = async (req, res) => {
  try {
    const { itemId } = req.params;

    if (!mongoose.isValidObjectId(itemId)) {
      return res.status(400).json({ success: false, message: "Invalid item id" });
    }

    const cart = await CartModel.findOneAndUpdate(
      { userId: getUserId(req) },
      { $pull: { items: { _id: new mongoose.Types.ObjectId(itemId) } } },
      { new: true },
    );

    return res.status(200).json({
      success: true,
      message: "Item removed from cart",
      cart: await serializeCart(cart),
    });
  } catch (error) {
    return handleError(res, error, "Remove Cart Item Error");
  }
};

// ===================== 5. REMOVE ALL ITEMS OF ONE STORE =====================
const removeStoreItems = async (req, res) => {
  try {
    const { storeId } = req.params;

    if (!mongoose.isValidObjectId(storeId)) {
      return res.status(400).json({ success: false, message: "Invalid store id" });
    }

    const cart = await CartModel.findOneAndUpdate(
      { userId: getUserId(req) },
      { $pull: { items: { storeId: new mongoose.Types.ObjectId(storeId) } } },
      { new: true },
    );

    return res.status(200).json({
      success: true,
      message: "Store items removed from cart",
      cart: await serializeCart(cart),
    });
  } catch (error) {
    return handleError(res, error, "Remove Store Items Error");
  }
};

// ===================== 6. CLEAR CART =====================
const clearCart = async (req, res) => {
  try {
    await CartModel.updateOne({ userId: getUserId(req) }, { $set: { items: [] } });
    return res.status(200).json({ success: true, message: "Cart cleared" });
  } catch (error) {
    return handleError(res, error, "Clear Cart Error");
  }
};

module.exports = {
  addToCart,
  getCart,
  updateCartItem,
  removeCartItem,
  removeStoreItems,
  clearCart,
  serializeCart,
};