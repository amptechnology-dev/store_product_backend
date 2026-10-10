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

module.exports = {
  saveDeliverySettings,
  getDeliverySettings,
  previewServicePincodes,
  checkDelivery,
  lookupPincode,
  getMyPincode,
};
