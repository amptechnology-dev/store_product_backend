const BannerModel = require("../model/banner.model.js");
const UserModel = require("../model/user.model.js");
const StoreModel = require("../model/store.model.js");
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

// ===================== STORE (authenticated) =====================

const createBanner = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const parsedData = createBannerSchema.parse(req.body);

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
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

    const media = await uploadBannerMedia(req.files);
    if (!media) {
      return res
        .status(400)
        .json({ success: false, message: "Banner image or video is required" });
    }

    const banner = await BannerModel.create({
      ...parsedData,
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
        .populate("storeId", "storeName storeUniqueId")
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

    const banner = await BannerModel.findOne({ _id: id, userId }).populate(
      "storeId",
      "storeName storeUniqueId",
    );

    if (!banner) {
      return res.status(404).json({ success: false, message: "Banner not found" });
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

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    if (user.role !== "STORE") {
      return res
        .status(403)
        .json({ success: false, message: "Only STORE can update banner" });
    }

    const existingBanner = await BannerModel.findOne({ _id: id, userId });
    if (!existingBanner) {
      return res.status(404).json({ success: false, message: "Banner not found" });
    }

    const parsedData = updateBannerSchema.parse(req.body);
    // update e store change kora jabe na
    const { storeId, ...safeData } = parsedData;

    const updateFields = { ...safeData };

    // notun media dile replace, na dile purono ta thakbe
    const media = await uploadBannerMedia(req.files);
    if (media) {
      updateFields.image = media.url;
      updateFields.mediaType = media.mediaType;
    }

    const updatedBanner = await BannerModel.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true },
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

    const banner = await BannerModel.findOneAndDelete({ _id: id, userId });
    if (!banner) {
      return res.status(404).json({ success: false, message: "Banner not found" });
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
      .populate("storeId", "storeName storeUniqueId")
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

module.exports = {
  createBanner,
  getAllBanners,
  getSingleBanner,
  updateBanner,
  deleteBanner,
  publicGetAllBanners,
};