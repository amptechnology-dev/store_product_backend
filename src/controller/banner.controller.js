const mongoose = require("mongoose");
const BannerModel = require("../model/banner.model.js");
const UserModel = require("../model/user.model.js");
const StoreModel = require("../model/store.model.js");
const CategoryModel = require("../model/category.model.js");
const ProductModel = require("../model/product.model.js");
const {
  createBannerSchema,
  updateBannerSchema,
} = require("../schema/banner.schema.js");
const { uploadBannerMedia } = require("../helper/productImages.js");

const getUserId = (req) => req.user?._id || req.user?.id;

const escapeRegex = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const handleError = (res, error, label) => {
  console.error(`${label}:`, error);

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

  if (error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: Object.values(error.errors).map((e) => ({
        field: e.path,
        message: e.message,
      })),
    });
  }

  if (error.statusCode) {
    return res
      .status(error.statusCode)
      .json({ success: false, message: error.message });
  }

  return res
    .status(500)
    .json({ success: false, message: "Internal server error" });
};

// category ta ei store er kina check (banner e onno store er category dewa jabe na)
const categoryBelongsToStore = (categoryId, storeId) =>
  CategoryModel.exists({ _id: categoryId, storeId });

// product ta ei store er kina check, ar category dile product oi category r kina
// error message return kore, sob thik thakle null
const validateProductLink = async ({ productId, categoryId, storeId }) => {
  if (!productId) return null;

  const product = await ProductModel.findOne({ _id: productId, storeId })
    .select("categoryId")
    .lean();
  if (!product) return "Product not found for this store";

  if (categoryId && String(product.categoryId) !== String(categoryId)) {
    return "Selected product does not belong to the selected category";
  }
  return null;
};

const BANNER_POPULATE = [
  { path: "storeId", select: "storeName storeUniqueId" },
  { path: "categoryId", select: "name" },
  { path: "productId", select: "name productCode images" },
];

// ===================== STORE (authenticated) =====================

// form er product dropdown er jonno: ei store er product (category dile shudhu oi category r)
const getProductOptions = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { storeId, categoryId } = req.query;

    if (!mongoose.isValidObjectId(storeId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid store id" });
    }
    if (categoryId && !mongoose.isValidObjectId(categoryId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid category id" });
    }

    const ownsStore = await StoreModel.exists({ _id: storeId, userId });
    if (!ownsStore) {
      return res.status(403).json({
        success: false,
        message: "Store not found or not owned by you",
      });
    }

    const filter = { storeId };
    if (categoryId) filter.categoryId = categoryId;

    const products = await ProductModel.find(filter)
      .select("name productCode categoryId")
      .sort({ name: 1 })
      .limit(500)
      .lean();

    return res.status(200).json({ success: true, products });
  } catch (error) {
    return handleError(res, error, "Get Product Options Error");
  }
};

const createBanner = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const parsedData = createBannerSchema.parse(req.body);

    const user = await UserModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    if (user.role !== "STORE") {
      return res
        .status(403)
        .json({ success: false, message: "Only STORE can create banner" });
    }

    // storeId login user er nijer store kina check
    const store = await StoreModel.findOne({ _id: parsedData.storeId, userId });
    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found or not owned by you",
      });
    }

    // categoryId optional, dile oi store er category hote hobe
    if (parsedData.categoryId) {
      const validCategory = await categoryBelongsToStore(
        parsedData.categoryId,
        parsedData.storeId,
      );
      if (!validCategory) {
        return res.status(400).json({
          success: false,
          message: "Category not found for this store",
        });
      }
    }

    // productId optional, dile oi store er product hote hobe
    const linkError = await validateProductLink({
      productId: parsedData.productId,
      categoryId: parsedData.categoryId,
      storeId: parsedData.storeId,
    });
    if (linkError) {
      return res.status(400).json({ success: false, message: linkError });
    }

    const media = await uploadBannerMedia(req.files);
    if (!media) {
      return res
        .status(400)
        .json({ success: false, message: "Banner image or video is required" });
    }

    const banner = await BannerModel.create({
      ...parsedData,
      categoryId: parsedData.categoryId || null,
      productId: parsedData.productId || null,
      image: media.url,
      mediaType: media.mediaType,
      userId,
    });

    return res.status(201).json({
      success: true,
      message: "Banner created successfully",
      data: banner,
    });
  } catch (error) {
    return handleError(res, error, "Create Banner Error");
  }
};

const getAllBanners = async (req, res) => {
  try {
    const userId = getUserId(req);

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);
    const search = String(req.query.search || "").trim();

    const match = { userId };
    if (search) {
      match.name = { $regex: escapeRegex(search), $options: "i" };
    }

    const skip = (page - 1) * limit;

    const [banners, totalBanners] = await Promise.all([
      BannerModel.find(match)
        .populate(BANNER_POPULATE)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      BannerModel.countDocuments(match),
    ]);

    return res.status(200).json({
      success: true,
      page,
      limit,
      totalPages: Math.ceil(totalBanners / limit),
      totalBanners,
      banners,
    });
  } catch (error) {
    return handleError(res, error, "Get All Banners Error");
  }
};

const getSingleBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid banner id" });
    }

    const banner = await BannerModel.findOne({ _id: id, userId }).populate(
      BANNER_POPULATE,
    );

    if (!banner) {
      return res
        .status(404)
        .json({ success: false, message: "Banner not found" });
    }

    return res.status(200).json({ success: true, banner });
  } catch (error) {
    return handleError(res, error, "Get Single Banner Error");
  }
};

const updateBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid banner id" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    if (user.role !== "STORE") {
      return res
        .status(403)
        .json({ success: false, message: "Only STORE can update banner" });
    }

    const existingBanner = await BannerModel.findOne({ _id: id, userId });
    if (!existingBanner) {
      return res
        .status(404)
        .json({ success: false, message: "Banner not found" });
    }

    const parsedData = updateBannerSchema.parse(req.body);
    // update e store change kora jabe na
    const { storeId, ...safeData } = parsedData;

    const updateFields = { ...safeData };

    // categoryId: undefined = change nai, null = remove, value = set (store check shoho)
    if (safeData.categoryId === undefined) {
      delete updateFields.categoryId;
    } else if (safeData.categoryId) {
      const validCategory = await categoryBelongsToStore(
        safeData.categoryId,
        existingBanner.storeId,
      );
      if (!validCategory) {
        return res.status(400).json({
          success: false,
          message: "Category not found for this store",
        });
      }
    }

    // productId: undefined = change nai, null = remove, value = set
    if (safeData.productId === undefined) {
      delete updateFields.productId;
    }

    // product ba category change hole, final (effective) combination ta valid kina check
    const effectiveProductId =
      safeData.productId === undefined
        ? existingBanner.productId
        : safeData.productId;
    const effectiveCategoryId =
      safeData.categoryId === undefined
        ? existingBanner.categoryId
        : safeData.categoryId;

    if (
      effectiveProductId &&
      (safeData.productId !== undefined || safeData.categoryId !== undefined)
    ) {
      const linkError = await validateProductLink({
        productId: effectiveProductId,
        categoryId: effectiveCategoryId,
        storeId: existingBanner.storeId,
      });
      if (linkError) {
        return res.status(400).json({ success: false, message: linkError });
      }
    }

    // notun media dile replace, na dile purono ta thakbe
    const media = await uploadBannerMedia(req.files);
    if (media) {
      updateFields.image = media.url;
      updateFields.mediaType = media.mediaType;
    }

    const updatedBanner = await BannerModel.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { returnDocument: "after", runValidators: true },
    );

    return res.status(200).json({
      success: true,
      message: "Banner updated successfully",
      data: updatedBanner,
    });
  } catch (error) {
    return handleError(res, error, "Update Banner Error");
  }
};

const deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid banner id" });
    }

    const banner = await BannerModel.findOneAndDelete({ _id: id, userId });
    if (!banner) {
      return res
        .status(404)
        .json({ success: false, message: "Banner not found" });
    }

    return res
      .status(200)
      .json({ success: true, message: "Banner deleted permanently" });
  } catch (error) {
    return handleError(res, error, "Delete Banner Error");
  }
};

// ===================== PUBLIC =====================
const publicGetAllBanners = async (req, res) => {
  try {
    const banners = await BannerModel.find({ isActive: true })
      .populate(BANNER_POPULATE)
      .sort({ createdAt: -1 })
      .select("-userId -__v");

    return res.status(200).json({
      success: true,
      count: banners.length,
      banners,
    });
  } catch (error) {
    return handleError(res, error, "Public Get Banners Error");
  }
};

const publicGetBannersByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { storeId, includeGeneral } = req.query;

    if (!mongoose.isValidObjectId(categoryId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid category id" });
    }
    if (storeId && !mongoose.isValidObjectId(storeId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid store id" });
    }

    const filter = { isActive: true };
    if (storeId) filter.storeId = storeId;

    filter.categoryId =
      includeGeneral === "true" ? { $in: [categoryId, null] } : categoryId;

    const banners = await BannerModel.find(filter)
      .populate(BANNER_POPULATE)
      .sort({ createdAt: -1 })
      .select("-userId -__v");

    return res.status(200).json({
      success: true,
      count: banners.length,
      banners,
    });
  } catch (error) {
    return handleError(res, error, "Public Get Banners By Category Error");
  }
};

module.exports = {
  getProductOptions,
  createBanner,
  getAllBanners,
  getSingleBanner,
  updateBanner,
  deleteBanner,
  publicGetAllBanners,
  publicGetBannersByCategory,
};