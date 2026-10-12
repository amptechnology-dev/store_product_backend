const StoreDeliveryModel = require("../model/storeDelivery.model.js");
const PincodeModel = require("../model/pincode.model.js");
const shiprocket = require("./shiprocket.js");
const { getStorePolicy } = require("./storePolicy.js");

const EARTH_RADIUS_KM = 6378.1;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const isValidPincode = (p) => /^[1-9][0-9]{5}$/.test(String(p || "").trim());

const toRad = (d) => (d * Math.PI) / 180;
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

// coordinates = [lng, lat]
const haversineKm = ([lng1, lat1], [lng2, lat2]) => {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
};

// aaj (IST) theke n din por, date hishebe (T00:00:00.000Z — toDeliveryDate er moto)
const addDaysFromToday = (days) => {
  const d = new Date(Date.now() + IST_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

// source: MANUAL = store er nijer days, SHIPROCKET = courier er asol ETA / rate
// shippingCharge: customer er order total e jog hoy
const buildInfo = (mode, distanceKm, minDays, maxDays, extra = {}) => ({
  mode,
  distanceKm,
  minDays,
  maxDays,
  estimatedMinDate: addDaysFromToday(minDays),
  estimatedMaxDate: addDaysFromToday(maxDays),
  source: "MANUAL",
  courierId: null,
  courierName: null,
  shippingCharge: 0,
  ...extra,
});

// Radius er moddhe kon kon pincode porche (store er jonno preview)
const findPincodesInRadius = ({ coordinates, radiusKm, limit = 500 }) =>
  PincodeModel.find({
    location: {
      $geoWithin: { $centerSphere: [coordinates, radiusKm / EARTH_RADIUS_KM] },
    },
  })
    .select("pincode area district state -_id")
    .sort({ pincode: 1 })
    .limit(limit)
    .lean();

const countPincodesInRadius = ({ coordinates, radiusKm }) =>
  PincodeModel.countDocuments({
    location: {
      $geoWithin: { $centerSphere: [coordinates, radiusKm / EARTH_RADIUS_KM] },
    },
  });

// NATIONAL: Shiprocket thakle courier er asol ETA + rate, nahole store er manual days + fallback charge
const resolveNational = async ({ cfg, pin, handling, weightKg, cod }) => {
  if (shiprocket.isAvailable()) {
    try {
      const svc = await shiprocket.checkServiceability({
        pickupPostcode: cfg.pincode,
        deliveryPostcode: pin,
        weightKg,
        cod,
      });

      if (!svc.serviceable) return { serviceable: false, info: null };

      // min = shobcheye druto courier, max = shobcheye sosta courier er ETA
      const minDays = handling + svc.fastest.etaDays;
      const maxDays = Math.max(minDays, handling + svc.cheapest.etaDays);

      return {
        serviceable: true,
        info: buildInfo("NATIONAL", null, minDays, maxDays, {
          source: "SHIPROCKET",
          courierId: svc.cheapest.id,
          courierName: svc.cheapest.name,
          shippingCharge: round2(svc.cheapest.rate),
        }),
      };
    } catch (err) {
      // Shiprocket e somossa hole order/listing atkabe na, manual estimate e fallback
      console.error(
        "Shiprocket serviceability failed, using manual estimate:",
        err.message,
      );
    }
  }

  return {
    serviceable: true,
    info: buildInfo(
      "NATIONAL",
      null,
      handling + (cfg.nationalMinDays || 0),
      handling + (cfg.nationalMaxDays || 0),
      { shippingCharge: round2(cfg.nationalFallbackCharge) },
    ),
  };
};

/**
 * Ekta store ei user pincode e deliver kore kina + date estimate + shipping charge.
 * Return: { deliverable, configured, message?, info }
 *  - configured=false : store e delivery off ba setting nei -> kono restriction / estimate / charge nei
 *  - weightKg / cod : shudhu NATIONAL (courier) hishabe lage. Listing e na dile default weight, prepaid
 *  - policy : getStorePolicy er result (dile abar DB query hoy na)
 */
const checkStoreDelivery = async ({
  storeId,
  pincode,
  weightKg,
  cod = false,
  policy,
}) => {
  const pol = policy || (await getStorePolicy(storeId));

  // [SETTINGS] store delivery off korle estimate / charge / pincode restriction kichui nei
  if (!pol.hasDelivery) {
    return { deliverable: true, configured: false, disabled: true, info: null };
  }

  const cfg = await StoreDeliveryModel.findOne({
    storeId,
    isActive: true,
  }).lean();

  if (!cfg) return { deliverable: true, configured: false, info: null };

  const pin = String(pincode || "").trim();
  if (!isValidPincode(pin)) {
    return {
      deliverable: false,
      configured: true,
      info: null,
      message: "Please enter a valid 6 digit pincode",
    };
  }

  const handling = cfg.handlingDays || 0;
  const allowLocal = cfg.deliveryType === "LOCAL" || cfg.deliveryType === "BOTH";
  const allowNational =
    cfg.deliveryType === "NATIONAL" || cfg.deliveryType === "BOTH";

  // ---------- LOCAL: radius check ----------
  if (allowLocal && cfg.radiusKm) {
    let distanceKm = null;

    if (pin === cfg.pincode) {
      distanceKm = 0;
    } else {
      const userPin = await PincodeModel.findOne({ pincode: pin })
        .select("location")
        .lean();
      if (userPin?.location?.coordinates?.length === 2) {
        distanceKm = round1(
          haversineKm(cfg.location.coordinates, userPin.location.coordinates),
        );
      }
    }

    if (distanceKm !== null && distanceKm <= cfg.radiusKm) {
      const days = handling + (cfg.localDeliveryDays || 0);
      return {
        deliverable: true,
        configured: true,
        info: buildInfo("LOCAL", distanceKm, days, days, {
          shippingCharge: round2(cfg.localDeliveryCharge),
        }),
      };
    }
  }

  // ---------- NATIONAL: courier ----------
  if (allowNational) {
    const national = await resolveNational({
      cfg,
      pin,
      handling,
      weightKg,
      cod,
    });

    if (!national.serviceable) {
      return {
        deliverable: false,
        configured: true,
        info: null,
        message: `Courier delivery is not available for pincode ${pin}`,
      };
    }
    return { deliverable: true, configured: true, info: national.info };
  }

  return {
    deliverable: false,
    configured: true,
    info: null,
    message: `This store does not deliver to pincode ${pin}`,
  };
};

// ---------- listing / product card er jonno ----------
const formatDeliveryLabel = (minDays, maxDays) => {
  if (minDays === maxDays) {
    if (minDays <= 0) return "Same day delivery";
    if (minDays === 1) return "Delivery in 1 day";
    return `Delivery in ${minDays} days`;
  }
  return `Delivery in ${minDays}-${maxDays} days`;
};

/**
 * Product listing / detail e dekhanor jonno chhoto summary.
 * - pincode nei, store e delivery off, ba setting nei -> null
 * - deliverable na -> { deliverable: false, label: "..." }
 */
const getDeliverySummary = async ({ storeId, pincode }) => {
  const pin = String(pincode || "").trim();
  if (!pin) return null;

  const policy = await getStorePolicy(storeId);
  if (!policy.hasDelivery) return null;

  const result = await checkStoreDelivery({ storeId, pincode: pin, policy });
  if (!result.configured) return null;

  if (!result.deliverable) {
    return {
      deliverable: false,
      mode: null,
      distanceKm: null,
      minDays: null,
      maxDays: null,
      estimatedMinDate: null,
      estimatedMaxDate: null,
      shippingCharge: null,
      courierName: null,
      label: result.message,
    };
  }

  const {
    mode,
    distanceKm,
    minDays,
    maxDays,
    estimatedMinDate,
    estimatedMaxDate,
    shippingCharge,
    courierName,
  } = result.info;

  return {
    deliverable: true,
    mode,
    distanceKm,
    minDays,
    maxDays,
    estimatedMinDate,
    estimatedMaxDate,
    shippingCharge: shippingCharge ?? 0,
    courierName: courierName ?? null,
    label: formatDeliveryLabel(minDays, maxDays),
  };
};

module.exports = {
  isValidPincode,
  haversineKm,
  findPincodesInRadius,
  countPincodesInRadius,
  checkStoreDelivery,
  formatDeliveryLabel,
  getDeliverySummary,
};