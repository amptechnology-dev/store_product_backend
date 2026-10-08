const { productHasTiers } = require("./priceTiers.js");

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// null / undefined / NaN / "" kono-tai "price" na
const hasPrice = (n) => typeof n === "number" && Number.isFinite(n);

const isBlank = (v) => v === undefined || v === null || v === "";

const QUOTE_PENDING_STATUSES = ["AWAITING_QUOTE", "QUOTED"];

// price-less item bad diye totals (price thaka item gulo-r upor)
const computeTotals = (items) => {
  const priced = items.filter((i) => hasPrice(i.offerPrice));
  const totalItems = items.reduce((s, i) => s + i.quantity, 0);
  const totalMrp = round2(
    priced.reduce(
      (s, i) => s + (hasPrice(i.mrp) ? i.mrp : i.offerPrice) * i.quantity,
      0,
    ),
  );
  const totalAmount = round2(priced.reduce((s, i) => s + i.lineTotal, 0));
  const discount = round2(Math.max(0, totalMrp - totalAmount));
  return { totalItems, totalMrp, totalAmount, discount };
};

// product er kono level e (simple / variant / size / tier) price nai
const isPriceOnRequestProduct = (p) => {
  if (hasPrice(p.offerPrice) || hasPrice(p.mrp)) return false;
  if (productHasTiers(p)) return false;
  return !(p.variants || []).some(
    (v) =>
      hasPrice(v.offerPrice) ||
      hasPrice(v.mrp) ||
      (v.sizeVariants || []).some(
        (s) => hasPrice(s.offerPrice) || hasPrice(s.mrp),
      ),
  );
};

// offer price ache kintu MRP nai (simple / variant / size)
const hasOfferWithoutMrp = (row) =>
  isBlank(row?.mrp) && !isBlank(row?.offerPrice);

const findOfferWithoutMrp = (body) =>
  hasOfferWithoutMrp(body) ||
  (Array.isArray(body.variants) ? body.variants : []).some(
    (v) =>
      hasOfferWithoutMrp(v) ||
      (Array.isArray(v?.sizeVariants) ? v.sizeVariants : []).some(
        hasOfferWithoutMrp,
      ),
  );

module.exports = {
  round2,
  hasPrice,
  isBlank,
  QUOTE_PENDING_STATUSES,
  computeTotals,
  isPriceOnRequestProduct,
  findOfferWithoutMrp,
};