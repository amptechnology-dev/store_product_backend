// helper/validateProduct.js

const buildPackaging = (input = {}) => ({
  expectedDeliveryDays:
    input.expectedDeliveryDays !== undefined ? Number(input.expectedDeliveryDays) : undefined,
  length: input.length !== undefined ? Number(input.length) : undefined,
  breadth: input.breadth !== undefined ? Number(input.breadth) : undefined,
  height: input.height !== undefined ? Number(input.height) : undefined,
  weight: input.weight !== undefined ? Number(input.weight) : undefined,
});

const buildStock = (input = {}) => {
  const openingStock = Number(input.openingStock ?? 0);
  return { openingStock, currentStock: openingStock };
};

// ---------- Ekta sizeVariant "truly empty" kina check kora ----------
// size/weight/height/mrp/offerPrice - kono field e kono value nei mane eta
// UI-r stray default row, real data na. Eita silently skip kora hobe.
const isEmptySizeVariant = (raw = {}) => {
  const hasText = raw.size || raw.weight || raw.height || raw.sku;
  const hasPricing =
    raw.mrp !== undefined && raw.mrp !== null && raw.mrp !== "" &&
    raw.offerPrice !== undefined && raw.offerPrice !== null && raw.offerPrice !== "";
  return !hasText && !hasPricing;
};

// ---------- Ekta colorVariant "truly empty" kina check kora ----------
const isEmptyColorVariant = (raw = {}) => {
  const hasColor = !!raw.color;
  const hasSizeVariants = Array.isArray(raw.sizeVariants) && raw.sizeVariants.length > 0;
  const hasPricing =
    raw.mrp !== undefined && raw.mrp !== null && raw.mrp !== "" &&
    raw.offerPrice !== undefined && raw.offerPrice !== null && raw.offerPrice !== "";
  return !hasColor && !hasSizeVariants && !hasPricing;
};

const validatePricing = (raw, errors, path) => {
  if (raw.mrp === undefined || raw.mrp === null || raw.mrp === "") {
    errors.push({ field: `${path}.mrp`, message: "MRP is required" });
  }
  if (raw.offerPrice === undefined || raw.offerPrice === null || raw.offerPrice === "") {
    errors.push({ field: `${path}.offerPrice`, message: "Offer price is required" });
  }
  if (
    raw.mrp !== undefined &&
    raw.offerPrice !== undefined &&
    Number(raw.offerPrice) > Number(raw.mrp)
  ) {
    errors.push({ field: `${path}.offerPrice`, message: "Offer price cannot be greater than MRP" });
  }
};

const buildSizeVariant = (raw, errors, path) => {
  validatePricing(raw, errors, path);
  return {
    size: raw.size ?? null,
    weight: raw.weight ?? null,
    height: raw.height ?? null,
    mrp: raw.mrp !== undefined ? Number(raw.mrp) : undefined,
    offerPrice: raw.offerPrice !== undefined ? Number(raw.offerPrice) : undefined,
    ...buildStock(raw),
    sku: raw.sku ?? null,
    isActive: raw.isActive ?? true,
    packagingDetails: buildPackaging(raw.packagingDetails),
  };
};

const buildColorVariant = (raw, errors, path) => {
  if (!raw.color) {
    errors.push({ field: `${path}.color`, message: "Color is required" });
  }

  // ---------- FIX: stray empty sizeVariant row gulo age filter kore felo ----------
  const rawSizeVariants = (Array.isArray(raw.sizeVariants) ? raw.sizeVariants : []).filter(
    (sv) => !isEmptySizeVariant(sv),
  );
  const hasSizeVariants = rawSizeVariants.length > 0;

  const base = {
    color: raw.color ?? null,
    images: Array.isArray(raw.images) ? raw.images : [],
    isActive: raw.isActive ?? true,
    packagingDetails: buildPackaging(raw.packagingDetails),
    sizeVariants: [],
  };

  if (hasSizeVariants) {
    base.sizeVariants = rawSizeVariants.map((sv, idx) =>
      buildSizeVariant(sv, errors, `${path}.sizeVariants[${idx}]`),
    );
    base.mrp = undefined;
    base.offerPrice = undefined;
    base.openingStock = 0;
    base.currentStock = 0;
  } else {
    validatePricing(raw, errors, path);
    base.mrp = raw.mrp !== undefined ? Number(raw.mrp) : undefined;
    base.offerPrice = raw.offerPrice !== undefined ? Number(raw.offerPrice) : undefined;
    Object.assign(base, buildStock(raw));
    base.sku = raw.sku ?? null;
  }

  return base;
};

/**
 * body: raw req.body (variants field already JSON.parse kora thakte hobe controller e)
 * returns: { errors, data, hasVariants, hasColor }
 */
const validateProduct = (body) => {
  const errors = [];
  const data = {};

  // ---------- FIX: shobar age stray empty top-level variant row gulo filter kora ----------
  const allRawVariants = Array.isArray(body.variants) ? body.variants : [];
  const rawVariants = allRawVariants.filter((v) => {
    if (!v) return false;
    // color-object hole color-emptiness check, na hole size-emptiness check
    if (Object.prototype.hasOwnProperty.call(v, "color") || Array.isArray(v.sizeVariants)) {
      return !isEmptyColorVariant(v);
    }
    return !isEmptySizeVariant(v);
  });

  const hasVariants = rawVariants.length > 0;
  const hasColor = hasVariants && rawVariants.some((v) => v && v.color);

  if (!hasVariants) {
    // ---------- Simple product (variant thakleo shob khali chilo, tai simple hisebe treat) ----------
    validatePricing(body, errors, "");
    data.mrp = body.mrp !== undefined ? Number(body.mrp) : undefined;
    data.offerPrice = body.offerPrice !== undefined ? Number(body.offerPrice) : undefined;
    Object.assign(data, buildStock(body));
    data.packagingDetails = buildPackaging(body.packagingDetails);
    data.variants = [];
  } else if (hasColor) {
    const invalidIdx = rawVariants.findIndex((v) => !v.color);
    if (invalidIdx !== -1) {
      errors.push({
        field: `variants[${invalidIdx}].color`,
        message: "All variants must have a color when color variants are used",
      });
    }
    data.variants = rawVariants.map((v, idx) =>
      buildColorVariant(v, errors, `variants[${idx}]`),
    );
    data.mrp = undefined;
    data.offerPrice = undefined;
    data.openingStock = 0;
    data.currentStock = 0;
    data.packagingDetails = buildPackaging(body.packagingDetails);
  } else {
    data.variants = rawVariants.map((v, idx) =>
      buildSizeVariant(v, errors, `variants[${idx}]`),
    );
    data.mrp = undefined;
    data.offerPrice = undefined;
    data.openingStock = 0;
    data.currentStock = 0;
    data.packagingDetails = buildPackaging(body.packagingDetails);
  }

  return { errors, data, hasVariants, hasColor };
};

module.exports = { validateProduct };