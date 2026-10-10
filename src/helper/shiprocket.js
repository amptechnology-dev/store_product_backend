const BASE_URL = "https://apiv2.shiprocket.in/v1/external";

const TOKEN_TTL_MS = 20 * 60 * 60 * 1000; // docs e 24h theke 10 din bola ache, tai 20h e refresh
const TIMEOUT_MS = 8000;
const DOWN_COOLDOWN_MS = 2 * 60 * 1000; // Shiprocket down hole 2 min bondho rakhi (proti request e timeout na khaoar jonno)
const SERVICE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SERVICE_CACHE_MAX = 2000;

// product er packagingDetails.weight er unit -> kg. Jodi gram e rakho tahole 0.001 koro
const PACKAGING_WEIGHT_TO_KG = 1;
const DEFAULT_DIM_CM = 10;

const getDefaultWeightKg = () =>
  Number(process.env.SHIPROCKET_DEFAULT_WEIGHT_KG) > 0
    ? Number(process.env.SHIPROCKET_DEFAULT_WEIGHT_KG)
    : 0.5;

class ShiprocketError extends Error {
  constructor(message, { status = null, data = null, network = false } = {}) {
    super(message);
    this.name = "ShiprocketError";
    this.status = status;
    this.data = data;
    this.network = network;
  }
}

const isConfigured = () =>
  !!process.env.SHIPROCKET_EMAIL &&
  !!process.env.SHIPROCKET_PASSWORD &&
  process.env.SHIPROCKET_ENABLED !== "false";

// ---------- availability (circuit breaker) ----------
let downUntil = 0;
const isAvailable = () => isConfigured() && Date.now() >= downUntil;
const markDown = (err) => {
  if (err?.network || (err?.status && err.status >= 500)) {
    downUntil = Date.now() + DOWN_COOLDOWN_MS;
  }
};

// ---------- low level fetch ----------
const rawFetch = async (url, options = {}) => {
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new ShiprocketError(`Shiprocket network error: ${err.message}`, {
      network: true,
    });
  }
  const data = await res.json().catch(() => ({}));
  return { res, data };
};

// ---------- token ----------
let tokenCache = { token: null, expiresAt: 0 };
let loginPromise = null;

const login = () => {
  if (loginPromise) return loginPromise;

  loginPromise = (async () => {
    const { res, data } = await rawFetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.SHIPROCKET_EMAIL,
        password: process.env.SHIPROCKET_PASSWORD,
      }),
    });
    if (!res.ok || !data.token) {
      throw new ShiprocketError(data.message || "Shiprocket login failed", {
        status: res.status,
        data,
      });
    }
    tokenCache = { token: data.token, expiresAt: Date.now() + TOKEN_TTL_MS };
    return tokenCache.token;
  })()
    .catch((err) => {
      // login fail hole (vul credential / network) bar bar try na kore kichukkhon thamo
      downUntil = Date.now() + DOWN_COOLDOWN_MS;
      throw err;
    })
    .finally(() => {
      loginPromise = null;
    });

  return loginPromise;
};

const getToken = async () =>
  tokenCache.token && Date.now() < tokenCache.expiresAt
    ? tokenCache.token
    : login();

// ---------- request ----------
const request = async (method, path, { query, body } = {}, retried = false) => {
  const token = await getToken();

  const qs = query
    ? `?${new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)]),
      ).toString()}`
    : "";

  const { res, data } = await rawFetch(`${BASE_URL}${path}${qs}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (process.env.SHIPROCKET_DEBUG === "true") {
    console.log(
      `[Shiprocket] ${method} ${path}${qs} -> ${res.status}`,
      JSON.stringify(data).slice(0, 2000),
    );
  }

  // token expire hoye gele ekbar notun token niye retry
  if (res.status === 401 && !retried) {
    tokenCache = { token: null, expiresAt: 0 };
    return request(method, path, { query, body }, true);
  }

  if (!res.ok) {
    const message =
      data?.message ||
      (data?.errors && JSON.stringify(data.errors)) ||
      `Shiprocket request failed (${res.status})`;
    throw new ShiprocketError(message, { status: res.status, data });
  }
  return data;
};

// ---------- serviceability (cache soho) ----------
const serviceCache = new Map();

const normalizeServiceability = (data, cod) => {
  const list = data?.data?.available_courier_companies || [];

  let couriers = list
    .map((c) => ({
      id: Number(c.courier_company_id),
      name: c.courier_name,
      rate: Number(c.rate ?? c.freight_charge ?? 0),
      etaDays: parseInt(c.estimated_delivery_days, 10),
      etd: c.etd || null,
      cod: Number(c.cod) === 1,
      rating: Number(c.rating) || null,
    }))
    .filter((c) => Number.isFinite(c.etaDays) && c.etaDays >= 0);

  // COD lagle shudhu COD support kora courier (flag ashle-i filter kori)
  if (cod && list.some((c) => c.cod !== undefined)) {
    couriers = couriers.filter((c) => c.cod);
  }

  if (couriers.length === 0) return { serviceable: false, couriers: [] };

  const cheapest = [...couriers].sort(
    (a, b) => a.rate - b.rate || a.etaDays - b.etaDays,
  )[0];
  const fastest = [...couriers].sort(
    (a, b) => a.etaDays - b.etaDays || a.rate - b.rate,
  )[0];

  return { serviceable: true, couriers, cheapest, fastest };
};

const checkServiceability = async ({
  pickupPostcode,
  deliveryPostcode,
  weightKg,
  cod = false,
}) => {
  const weight =
    Math.round((Number(weightKg) > 0 ? Number(weightKg) : getDefaultWeightKg()) * 100) /
    100;
  const key = `${pickupPostcode}|${deliveryPostcode}|${weight}|${cod ? 1 : 0}`;

  const hit = serviceCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  let value;
  try {
    const data = await request("GET", "/courier/serviceability/", {
      query: {
        pickup_postcode: pickupPostcode,
        delivery_postcode: deliveryPostcode,
        weight,
        cod: cod ? 1 : 0,
      },
    });
    value = normalizeServiceability(data, !!cod);
  } catch (err) {
    // courier nei emon pincode e Shiprocket 404 dey
    if (err.status === 404) {
      value = { serviceable: false, couriers: [] };
    } else {
      markDown(err);
      throw err;
    }
  }

  if (serviceCache.size >= SERVICE_CACHE_MAX) {
    serviceCache.delete(serviceCache.keys().next().value);
  }
  serviceCache.set(key, { value, expiresAt: Date.now() + SERVICE_CACHE_TTL_MS });
  return value;
};

// ---------- shipment ----------
const createAdhocOrder = (payload) =>
  request("POST", "/orders/create/adhoc", { body: payload });

const assignAwb = ({ shipmentId, courierId }) =>
  request("POST", "/courier/assign/awb", {
    body: {
      shipment_id: shipmentId,
      ...(courierId ? { courier_id: courierId } : {}),
    },
  });

const generatePickup = (shipmentId) =>
  request("POST", "/courier/generate/pickup", {
    body: { shipment_id: [shipmentId] },
  });

// ---------- parcel weight / size (product packagingDetails theke) ----------
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// variant / sizeVariant er nijer packagingDetails thakle seta, nahole product er
const findPackaging = (product, variantId) => {
  if (!product) return {};
  if (variantId) {
    for (const v of product.variants || []) {
      if (String(v._id) === String(variantId) && v.packagingDetails) {
        return v.packagingDetails;
      }
      for (const sv of v.sizeVariants || []) {
        if (String(sv._id) === String(variantId) && sv.packagingDetails) {
          return sv.packagingDetails;
        }
      }
    }
  }
  return product.packagingDetails || {};
};

// entries: [{ product, variantId, quantity }]
const calcWeightKg = (entries) => {
  const total = entries.reduce((sum, { product, variantId, quantity }) => {
    const pkg = findPackaging(product, variantId);
    const w = num(pkg.weight);
    const unitKg = w ? w * PACKAGING_WEIGHT_TO_KG : getDefaultWeightKg();
    return sum + unitKg * (Number(quantity) || 1);
  }, 0);
  return Math.max(0.1, Math.round(total * 100) / 100);
};

// shob item ekta box e: length/breadth = max, height = joma (upore upore rakha dhora hoyeche)
const buildParcel = (entries) => {
  let length = 0;
  let breadth = 0;
  let height = 0;

  entries.forEach(({ product, variantId, quantity }) => {
    const pkg = findPackaging(product, variantId);
    length = Math.max(length, num(pkg.length) || DEFAULT_DIM_CM);
    breadth = Math.max(breadth, num(pkg.breadth) || DEFAULT_DIM_CM);
    height += (num(pkg.height) || DEFAULT_DIM_CM) * (Number(quantity) || 1);
  });

  const r1 = (n) => Math.round(n * 10) / 10;
  return {
    length: r1(length),
    breadth: r1(breadth),
    height: r1(height),
    weight: calcWeightKg(entries),
  };
};

module.exports = {
  ShiprocketError,
  isConfigured,
  isAvailable,
  checkServiceability,
  createAdhocOrder,
  assignAwb,
  generatePickup,
  calcWeightKg,
  buildParcel,
};