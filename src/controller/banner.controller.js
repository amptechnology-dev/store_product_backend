const BannerModel = require("../model/banner.model.js");
const UserModel = require("../model/user.model.js");
const StoreModel = require("../model/store.model.js");
const {
  createBannerSchema,
  updateBannerSchema,
} = require("../schema/banner.schema.js");
const { uploadToR2 } = require("../helper/upload.js");

// ===================== STORE (authenticated) =====================

const createBanner = async (req, res) => {
  try {
    const parsedData = createBannerSchema.parse(req.body);
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    if (user.role !== "STORE") {
      return res.status(403).json({
        success: false,
        message: "Only STORE can create banner",
      });
    }

    // storeId eta login user-er nijer store kina check
    const store = await StoreModel.findOne({
      _id: parsedData.storeId,
      userId,
    });
    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found or not owned by you",
      });
    }

    if (!req.files?.length) {
      return res
        .status(400)
        .json({ success: false, message: "Banner image is required" });
    }

    const file =
      req.files.find((f) => f.fieldname.startsWith("image")) || req.files[0];
    const fileName = `amp-store/banner/${Date.now()}-${file.originalname}`;
    const image = await uploadToR2(file.buffer, fileName, file.mimetype);

    const banner = await BannerModel.create({
      ...parsedData,
      image,
      userId,
    });

    return res.status(201).json({
      success: true,
      message: "Banner created successfully",
      data: banner,
    });
  } catch (error) {
    console.log(error);

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
      const errors = Object.values(error.errors).map((e) => ({
        field: e.path,
        message: e.message,
      }));
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors,
      });
    }

    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// STORE-er nijer sob banner (list + search + pagination)
const getAllBanners = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";

    const match = { userId };
    if (search) {
      match.name = { $regex: search, $options: "i" };
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
    console.error("Get All Banners Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const getSingleBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id || req.user?.id;

    const banner = await BannerModel.findOne({ _id: id, userId }).populate(
      "storeId",
      "storeName storeUniqueId",
    );

    if (!banner) {
      return res.status(404).json({ success: false, message: "Banner not found" });
    }

    return res.status(200).json({ success: true, banner });
  } catch (error) {
    console.error("Get Single Banner Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const updateBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    if (user.role !== "STORE") {
      return res.status(403).json({
        success: false,
        message: "Only STORE can update banner",
      });
    }

    const existingBanner = await BannerModel.findOne({ _id: id, userId });
    if (!existingBanner) {
      return res.status(404).json({ success: false, message: "Banner not found" });
    }

    const parsedData = updateBannerSchema.parse(req.body);

    let image = existingBanner.image;
    if (req.files?.length) {
      const file =
        req.files.find((f) => f.fieldname.startsWith("image")) || req.files[0];
      const fileName = `amp-store/banner/${Date.now()}-${file.originalname}`;
      image = await uploadToR2(file.buffer, fileName, file.mimetype);
    }

    const updatedBanner = await BannerModel.findByIdAndUpdate(
      id,
      { $set: { ...parsedData, image } },
      { new: true, runValidators: true },
    );

    return res.status(200).json({
      success: true,
      message: "Banner updated successfully",
      data: updatedBanner,
    });
  } catch (error) {
    console.log(error);

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
      const errors = Object.values(error.errors).map((e) => ({
        field: e.path,
        message: e.message,
      }));
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors,
      });
    }

    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const banner = await BannerModel.findOne({ _id: id, userId });
    if (!banner) {
      return res.status(404).json({ success: false, message: "Banner not found" });
    }

    await BannerModel.findByIdAndDelete(id);

    return res
      .status(200)
      .json({ success: true, message: "Banner deleted permanently" });
  } catch (error) {
    console.error("Delete Banner Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ===================== PUBLIC =====================
// sab store-er sob active banner (storefront/home page-er jonno)
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
    console.error("Public Get Banners Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
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