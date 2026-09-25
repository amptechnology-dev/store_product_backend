const { uploadToR2 } = require("./upload.js");

// ---------- MAIN PRODUCT IMAGE ----------
// Frontend theke fieldname "image0", "image1", "image2" ... erokom pathano hoy
// Eta variant mode hok ba na hok, sob somoy call hobe controller theke.
const uploadSimpleImages = async (files = []) => {
  if (!files?.length) return [];

  const imageFiles = files.filter((f) => /^image\d+$/.test(f.fieldname));
  if (!imageFiles.length) return [];

  const uploaded = await Promise.all(
    imageFiles.map((file) => {
      const fileName = `products/${Date.now()}-${Math.round(
        Math.random() * 1e9,
      )}-${file.originalname}`;
      return uploadToR2(file.buffer, fileName, file.mimetype);
    }),
  );

  return uploaded;
};

// ---------- VARIANT (COLOR) IMAGE ----------
// Frontend theke fieldname "variantImage_0", "variantImage_1" ... erokom pathano hoy
// (0, 1 = variant index). Return kore { "0": [url1, url2], "1": [url3] }
const uploadVariantImages = async (files = []) => {
  if (!files?.length) return {};

  const variantFiles = files.filter((f) =>
    /^variantImage_\d+$/.test(f.fieldname),
  );
  if (!variantFiles.length) return {};

  const map = {};

  await Promise.all(
    variantFiles.map(async (file) => {
      const idx = file.fieldname.split("_")[1]; // "variantImage_2" -> "2"
      const fileName = `products/variants/${Date.now()}-${Math.round(
        Math.random() * 1e9,
      )}-${file.originalname}`;
      const url = await uploadToR2(file.buffer, fileName, file.mimetype);
      if (!map[idx]) map[idx] = [];
      map[idx].push(url);
    }),
  );

  return map;
};

module.exports = { uploadSimpleImages, uploadVariantImages };