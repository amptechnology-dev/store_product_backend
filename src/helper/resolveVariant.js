const findActiveVariant = (product, variantId) => {
  if (!variantId || !Array.isArray(product?.variants)) return null;
  const idStr = String(variantId);

  for (const v of product.variants) {
    if (String(v._id) === idStr && v.isActive !== false) {
      return {
        variant: v,
        color: v.color ?? null,
        colorImages: v.images ?? null,
      };
    }

    if (Array.isArray(v.sizeVariants) && v.sizeVariants.length) {
      const nested = v.sizeVariants.find(
        (sv) => String(sv._id) === idStr && sv.isActive !== false,
      );
      if (nested && v.isActive !== false) {
        return {
          variant: nested,
          color: v.color ?? null,
          colorImages: v.images ?? null,
        };
      }
    }
  }

  return null;
};

// variantId thakle -> oi variant-er live data (color/size/weight/height/image soho)
// variantId na thakle -> product simple (no variant) hole product-level data
// product-e variant thakle kintu variantId na dile -> null (invalid, variant select kora lagbe)
const resolveLineSource = (product, variantId) => {
  const hasVariants =
    Array.isArray(product?.variants) && product.variants.length > 0;

  if (variantId) {
    const found = findActiveVariant(product, variantId);
    if (!found) return null;

    const { variant, color, colorImages } = found;
    return {
      variantId: variant._id,
      mrp: variant.mrp,
      offerPrice: variant.offerPrice,
      stock: variant.currentStock,
      color: variant.color ?? color ?? null,
      size: variant.size ?? null,
      weight: variant.weight ?? null,
      height: variant.height ?? null,
      image:
        (variant.images && variant.images[0]) ||
        (colorImages && colorImages[0]) ||
        product.images?.[0] ||
        null,
    };
  }

  if (hasVariants) return null;

  if (product?.mrp === undefined || product?.mrp === null) return null;

  return {
    variantId: null,
    mrp: product.mrp,
    offerPrice: product.offerPrice,
    stock: product.currentStock,
    color: null,
    size: null,
    weight: null,
    height: null,
    image: product.images?.[0] ?? null,
  };
};

module.exports = { findActiveVariant, resolveLineSource };
