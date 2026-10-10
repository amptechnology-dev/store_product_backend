const mongoose = require("mongoose");
const StoreModel = require("../model/store.model.js");
const StoreDeliveryModel = require("../model/storeDelivery.model.js");
const PincodeModel = require("../model/pincode.model.js");
const { saveDeliverySettingsSchema } = require("../schema/delivery.schema.js");
const {
  isValidPincode,
  findPincodesInRadius,
  countPincodesInRadius,
  checkStoreDelivery,
} = require("../helper/deliveryEstimate.js");
const {
  AVAILABLE_STORE_FILTER,
  sendStoreUnavailable,
} = require("../helper/storeAvailability.js");
const UserModel = require("../model/user.model.js");
const crypto = require("crypto");
const OrderModel = require("../model/order.model.js");
const ProductModel = require("../model/product.model.js");
const shiprocket = require("../helper/shiprocket.js");
const { notifyUserOrderStatus } = require("../helper/notification.helper.js");

const getUserId = (req) => req.user?._id || req.user?.id;

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

const isStoreOwner = async (storeId, userId) =>
  !!(await StoreModel.exists({ _id: storeId, userId }));

// ===================== 1. STORE: SAVE / UPDATE DELIVERY SETTINGS =====================
// PUT /api/delivery/settings
// body: { storeId, deliveryType, pincode, radiusKm?, localDeliveryDays?,
//         nationalMinDays?, nationalMaxDays?, handlingDays? }
const saveDeliverySettings = async (req, res) => {
  try {
    const userId = getUserId(req);
    const data = saveDeliverySettingsSchema.parse(req.body);

    if (!mongoose.isValidObjectId(data.storeId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid store id" });
    }

    if (!(await isStoreOwner(data.storeId, userId))) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized for this store" });
    }

    // store er pincode theke lat/lng
    const pin = await PincodeModel.findOne({ pincode: data.pincode })
      .select("location area district state")
      .lean();
    if (!pin) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: [{ field: "pincode", message: "Pincode not found" }],
      });
    }

    const needsLocal =
      data.deliveryType === "LOCAL" || data.deliveryType === "BOTH";
    const needsNational =
      data.deliveryType === "NATIONAL" || data.deliveryType === "BOTH";

    const update = {
      deliveryType: data.deliveryType,
      pincode: data.pincode,
      location: pin.location,
      handlingDays: data.handlingDays ?? 1,
      radiusKm: needsLocal ? data.radiusKm : null,
      localDeliveryDays: needsLocal ? data.localDeliveryDays : 1,
      isActive: true,
    };
    if (needsNational) {
      update.nationalMinDays = data.nationalMinDays;
      update.nationalMaxDays = data.nationalMaxDays;
    }

    const settings = await StoreDeliveryModel.findOneAndUpdate(
      { storeId: data.storeId },
      { $set: update },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    ).lean();

    const servicePincodeCount = needsLocal
      ? await countPincodesInRadius({
          coordinates: settings.location.coordinates,
          radiusKm: settings.radiusKm,
        })
      : 0;

    return res.status(200).json({
      success: true,
      message: "Delivery settings saved",
      settings,
      storeArea: { area: pin.area, district: pin.district, state: pin.state },
      servicePincodeCount,
    });
  } catch (error) {
    return handleError(res, error, "Save Delivery Settings Error");
  }
};

// ===================== 2. STORE: GET MY DELIVERY SETTINGS =====================
// GET /api/delivery/settings/:storeId
const getDeliverySettings = async (req, res) => {
  try {
    const { storeId } = req.params;
    const userId = getUserId(req);

    if (!mongoose.isValidObjectId(storeId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid store id" });
    }
    if (!(await isStoreOwner(storeId, userId))) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized for this store" });
    }

    const settings = await StoreDeliveryModel.findOne({ storeId }).lean();
    // setting na thakle null, frontend "setup korun" dekhabe
    return res.status(200).json({ success: true, settings: settings || null });
  } catch (error) {
    return handleError(res, error, "Get Delivery Settings Error");
  }
};

// ===================== 3. STORE: PREVIEW SERVICEABLE PINCODES =====================
// GET /api/delivery/settings/:storeId/service-pincodes
// radius er moddhe kon kon pincode porche seta store ke dekhano
const previewServicePincodes = async (req, res) => {
  try {
    const { storeId } = req.params;
    const userId = getUserId(req);

    if (!mongoose.isValidObjectId(storeId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid store id" });
    }
    if (!(await isStoreOwner(storeId, userId))) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized for this store" });
    }

    const settings = await StoreDeliveryModel.findOne({ storeId }).lean();
    if (!settings || !settings.radiusKm) {
      return res.status(404).json({
        success: false,
        message: "Local delivery radius is not set for this store",
      });
    }

    const params = {
      coordinates: settings.location.coordinates,
      radiusKm: settings.radiusKm,
    };
    const [pincodes, total] = await Promise.all([
      findPincodesInRadius({ ...params, limit: 500 }),
      countPincodesInRadius(params),
    ]);

    return res.status(200).json({
      success: true,
      radiusKm: settings.radiusKm,
      total,
      truncated: total > pincodes.length,
      pincodes,
    });
  } catch (error) {
    return handleError(res, error, "Preview Service Pincodes Error");
  }
};

// ===================== 4. PUBLIC: CHECK DELIVERY + DATE ESTIMATE =====================
// GET /api/delivery/check?storeUniqueId=XXX&pincode=700001
const checkDelivery = async (req, res) => {
  try {
    const storeUniqueId = String(req.query.storeUniqueId || "").trim();
    const pincode = String(req.query.pincode || "").trim();

    if (!storeUniqueId) {
      return res
        .status(400)
        .json({ success: false, message: "storeUniqueId is required" });
    }
    if (!isValidPincode(pincode)) {
      return res
        .status(400)
        .json({ success: false, message: "Enter a valid 6 digit pincode" });
    }

    const store = await StoreModel.findOne({
      storeUniqueId,
      ...AVAILABLE_STORE_FILTER,
    })
      .select("_id")
      .lean();
    if (!store) return sendStoreUnavailable(res);

    const result = await checkStoreDelivery({ storeId: store._id, pincode });

    return res.status(200).json({
      success: true,
      deliverable: result.deliverable,
      configured: result.configured,
      message: result.message || null,
      delivery: result.info,
    });
  } catch (error) {
    return handleError(res, error, "Check Delivery Error");
  }
};

// ===================== 5. PUBLIC: PINCODE LOOKUP =====================
// GET /api/delivery/pincode/:pincode   (form e area/district/state autofill + validate)
const lookupPincode = async (req, res) => {
  try {
    const { pincode } = req.params;
    if (!isValidPincode(pincode)) {
      return res
        .status(400)
        .json({ success: false, message: "Enter a valid 6 digit pincode" });
    }

    const doc = await PincodeModel.findOne({ pincode })
      .select("pincode area district state -_id")
      .lean();
    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "Pincode not found" });
    }

    return res.status(200).json({ success: true, pincode: doc });
  } catch (error) {
    return handleError(res, error, "Lookup Pincode Error");
  }
};

const getMyPincode = async (req, res) => {
  try {
    const userId = getUserId(req);
    const user = await UserModel.findById(userId).select("addresses").lean();
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const addresses = user.addresses || [];
    const addr = addresses.find((a) => a.isDefault) || addresses[0] || null;

    return res.status(200).json({
      success: true,
      pincode: addr?.pincode || null,
      address: addr
        ? {
            _id: addr._id,
            label: addr.label,
            area: addr.area,
            city: addr.city,
            state: addr.state,
            pincode: addr.pincode,
          }
        : null,
    });
  } catch (error) {
    return handleError(res, error, "Get My Pincode Error");
  }
};

const SHIPMENT_ALLOWED_STATUS = ["CONFIRMED", "SHIPPED"];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const trackingUrlFor = (awb) => `https://shiprocket.co/tracking/${awb}`;
const fmtOrderDate = (d) =>
  new Date(new Date(d).getTime() + IST_OFFSET_MS)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");

const createShiprocketShipment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = getUserId(req);

    if (!mongoose.isValidObjectId(orderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order id" });
    }

    const order = await OrderModel.findById(orderId).lean();
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    if (!(await isStoreOwner(order.storeId, userId))) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this order",
      });
    }

    if (!SHIPMENT_ALLOWED_STATUS.includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: "Courier shipment can be created only for a confirmed order",
      });
    }

    if (order.deliveryInfo?.mode !== "NATIONAL") {
      return res.status(400).json({
        success: false,
        message: "Courier shipment is only for national delivery orders",
      });
    }

    if (!shiprocket.isConfigured()) {
      return res.status(503).json({
        success: false,
        message: "Courier service is not configured",
      });
    }

    let shipment = order.shipment || null;

    if (shipment?.awb && shipment?.pickupRequestedAt) {
      return res.status(409).json({
        success: false,
        message: "Courier shipment is already created for this order",
      });
    }

    const persist = async () => {
      await OrderModel.updateOne({ _id: orderId }, { $set: { shipment } });
    };

    // ---------- Step A: Shiprocket e order create ----------
    if (!shipment?.shipmentId) {
      const productIds = [...new Set(order.items.map((i) => String(i.productId)))];

      const [store, customer, products, storeDelivery] = await Promise.all([
        StoreModel.findById(order.storeId).select("storeUniqueId").lean(),
        UserModel.findById(order.userId).select("email").lean(),
        ProductModel.find({ _id: { $in: productIds } })
          .select(
            "packagingDetails variants._id variants.packagingDetails variants.sizeVariants._id variants.sizeVariants.packagingDetails",
          )
          .lean(),
        StoreDeliveryModel.findOne({ storeId: order.storeId })
          .select("pincode")
          .lean(),
      ]);

      if (!store?.storeUniqueId) {
        return res
          .status(400)
          .json({ success: false, message: "Store unique id not found" });
      }

      const productMap = new Map(products.map((p) => [String(p._id), p]));
      const parcel = shiprocket.buildParcel(
        order.items.map((item) => ({
          product: productMap.get(String(item.productId)),
          variantId: item.variantId,
          quantity: item.quantity,
        })),
      );

      const addr = order.deliveryAddress;
      const payload = {
        order_id: order.orderNumber,
        order_date: fmtOrderDate(order.createdAt),
        // Shiprocket panel e ei naam e pickup location thakte hobe (= storeUniqueId)
        pickup_location: store.storeUniqueId,
        billing_customer_name: addr.fullName,
        billing_last_name: "",
        billing_address: addr.addressLine,
        billing_address_2: addr.area || "",
        billing_city: addr.city,
        billing_pincode: addr.pincode,
        billing_state: addr.state,
        billing_country: addr.country || "India",
        billing_email: customer?.email || "",
        billing_phone: addr.phone,
        shipping_is_billing: true,
        order_items: order.items.map((item) => ({
          name: item.name,
          sku: item.productCode || String(item.productId),
          units: item.quantity,
          selling_price: item.offerPrice,
          discount: "",
          tax: "",
          hsn: "",
        })),
        payment_method: order.paymentMethod === "COD" ? "COD" : "Prepaid",
        sub_total: order.totalAmount,
        length: parcel.length,
        breadth: parcel.breadth,
        height: parcel.height,
        weight: parcel.weight,
      };

      const created = await shiprocket.createAdhocOrder(payload);
      if (!created?.shipment_id) {
        throw new shiprocket.ShiprocketError(
          created?.message || "Courier service did not return a shipment id",
          { data: created },
        );
      }

      shipment = {
        provider: "SHIPROCKET",
        shiprocketOrderId: created.order_id ?? null,
        shipmentId: created.shipment_id,
        awb: null,
        courierId: order.deliveryInfo?.courierId ?? null,
        courierName: order.deliveryInfo?.courierName ?? null,
        trackingUrl: null,
        status: "CREATED",
        pickupRequestedAt: null,
        lastEventAt: null,
        createdAt: new Date(),
      };
      await persist();
    }

    // ---------- Step B: AWB assign ----------
    if (!shipment.awb) {
      const awbRes = await shiprocket.assignAwb({
        shipmentId: shipment.shipmentId,
        courierId: shipment.courierId,
      });
      const awbData = awbRes?.response?.data || {};
      const awb = awbData.awb_code || awbRes?.awb_code;

      if (!awb) {
        throw new shiprocket.ShiprocketError(
          awbData.message ||
            awbRes?.message ||
            "AWB could not be assigned. Check the courier wallet balance",
          { data: awbRes },
        );
      }

      shipment = {
        ...shipment,
        awb: String(awb),
        courierId: awbData.courier_company_id ?? shipment.courierId,
        courierName: awbData.courier_name ?? shipment.courierName,
        trackingUrl: trackingUrlFor(awb),
        status: "AWB_ASSIGNED",
      };
      await persist();
    }

    // ---------- Step C: pickup request ----------
    let pickupError = null;
    if (!shipment.pickupRequestedAt) {
      try {
        await shiprocket.generatePickup(shipment.shipmentId);
        shipment = {
          ...shipment,
          pickupRequestedAt: new Date(),
          status: "PICKUP_SCHEDULED",
        };
      } catch (err) {
        if (/already/i.test(err.message || "")) {
          shipment = { ...shipment, pickupRequestedAt: new Date() };
        } else {
          pickupError = err.message;
        }
      }
    }

    // delivery date na thakle courier er estimate bosiye dei (store ar SHIPPED korte parbe)
    const set = { shipment };
    if (!order.expectedDeliveryDate && order.deliveryInfo?.estimatedMaxDate) {
      set.expectedDeliveryDate = order.deliveryInfo.estimatedMaxDate;
    }
    await OrderModel.updateOne({ _id: orderId }, { $set: set });

    const updated = await OrderModel.findById(orderId)
      .populate("userId", "name phone email")
      .lean();

    return res.status(200).json({
      success: true,
      message: pickupError
        ? "Shipment created, but pickup request failed. Try again"
        : "Courier shipment created and pickup requested",
      pickupRequested: !pickupError,
      pickupError,
      order: updated,
    });
  } catch (error) {
    if (error.name === "ShiprocketError") {
      console.error("Create Shiprocket Shipment Error:", error.message);
      return res.status(502).json({
        success: false,
        message: `Courier service error: ${error.message}. You can try again`,
      });
    }
    return handleError(res, error, "Create Shiprocket Shipment Error");
  }
};

// ===================== 8. WEBHOOK: courier tracking update =====================
// POST /api/delivery/courier-webhook   (header: x-api-key = SHIPROCKET_WEBHOOK_TOKEN)
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const courierWebhook = async (req, res) => {
  try {
    const secret = process.env.SHIPROCKET_WEBHOOK_TOKEN;
    if (!secret || !safeEqual(req.headers["x-api-key"], secret)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const body = req.body || {};
    const awb = String(body.awb || body.awb_code || "").trim();
    const rawStatus = String(
      body.current_status || body.shipment_status || "",
    ).trim();

    if (!awb || !rawStatus) {
      return res.status(200).json({ success: true, ignored: true });
    }

    const order = await OrderModel.findOne({ "shipment.awb": awb })
      .select("status paymentMethod")
      .lean();
    if (!order) {
      return res.status(200).json({ success: true, ignored: true });
    }

    await OrderModel.updateOne(
      { _id: order._id },
      {
        $set: {
          "shipment.status": rawStatus,
          "shipment.lastEventAt": new Date(),
        },
      },
    );

    // courier delivered dile order DELIVERED (RTO DELIVERED alada status, eta match korbe na)
    if (rawStatus.toUpperCase() === "DELIVERED" && order.status === "SHIPPED") {
      const extra =
        order.paymentMethod === "COD"
          ? { paymentStatus: "PAID", paidAt: new Date() }
          : {};

      const updated = await OrderModel.findOneAndUpdate(
        { _id: order._id, status: "SHIPPED" },
        {
          $set: { status: "DELIVERED", ...extra },
          $push: {
            statusHistory: {
              status: "DELIVERED",
              note: "Delivered by courier",
              at: new Date(),
            },
          },
        },
        { new: true },
      ).lean();

      if (updated) notifyUserOrderStatus(updated);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return handleError(res, error, "Courier Webhook Error");
  }
};

module.exports = {
  saveDeliverySettings,
  getDeliverySettings,
  previewServicePincodes,
  checkDelivery,
  lookupPincode,
  getMyPincode,
  createShiprocketShipment,
  courierWebhook,
};
