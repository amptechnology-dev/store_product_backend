const path = require("path");
const { uploadToR2 } = require("./upload.js");

const sanitizeName = (name = "") =>
  path
    .basename(name, path.extname(name))
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 50);

const buildFileName = (folder, file) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mediaFolder = file.mimetype.startsWith("video/") ? "videos" : "images";
  return `${folder}/${mediaFolder}/${Date.now()}-${Math.round(
    Math.random() * 1e9,
  )}-${sanitizeName(file.originalname)}${ext}`;
};

const uploadSimpleImages = async (files = []) => {
  if (!files?.length) return [];

  const mediaFiles = files
    .filter((f) => /^image\d+$/.test(f.fieldname))
    // fieldname er number diye order thik rakhi
    .sort(
      (a, b) =>
        Number(a.fieldname.replace("image", "")) -
        Number(b.fieldname.replace("image", "")),
    );
  if (!mediaFiles.length) return [];

  return Promise.all(
    mediaFiles.map((file) =>
      uploadToR2(file.buffer, buildFileName("products", file), file.mimetype),
    ),
  );
};

const uploadVariantImages = async (files = []) => {
  if (!files?.length) return {};

  const variantFiles = files.filter((f) =>
    /^variantImage_\d+$/.test(f.fieldname),
  );
  if (!variantFiles.length) return {};

  const uploaded = await Promise.all(
    variantFiles.map(async (file) => {
      const idx = file.fieldname.split("_")[1];
      const url = await uploadToR2(
        file.buffer,
        buildFileName("products/variants", file),
        file.mimetype,
      );
      return { idx, url };
    }),
  );

  return uploaded.reduce((map, { idx, url }) => {
    (map[idx] ||= []).push(url);
    return map;
  }, {});
};

module.exports = { uploadSimpleImages, uploadVariantImages };
