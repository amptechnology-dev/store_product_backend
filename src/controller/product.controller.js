const mongoose = require("mongoose");
const ProductModel = require("../model/product.model.js");
const UserModel = require("../model/user.model.js");
const StoreModel = require("../model/store.model.js");
const CategoryModel = require("../model/category.model.js");
const {
  createProductSchema,
  updateProductSchema,
} = require("../schema/product.schema.js");
const { uploadToR2 } = require("../helper/upload.js");
const sendProductVerifyEmail = require("../helper/sendProductVerifyEmail.js");
const { getStoreSettings } = require("../helper/storeSettings.js");
const {
  validateProductBySettings,
} = require("../helper/validateProductBySettings.js");
const {
  uploadSimpleImages,
  uploadVariantImages,
} = require("../helper/productImages.js");

const createProduct = async (req, res) => {
  try {
    const body = { ...req.body };
    if (typeof body.variants === "string") {
      try {
        body.variants = JSON.parse(body.variants);
      } catch {
        return res
          .status(400)
          .json({ success: false, message: "Invalid variants format" });
      }
    }

    const parsedData = createProductSchema.parse(body);
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
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
        .json({ success: false, message: "Only STORE can create product" });
    }

    const store = await StoreModel.findById(parsedData.storeId);
    if (!store) {
      return res
        .status(404)
        .json({ success: false, message: "Store not found" });
    }

    const category = await CategoryModel.findOne({
      _id: parsedData.categoryId,
      storeId: parsedData.storeId,
    });
    if (!category) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found for this store" });
    }

    // ---------- store settings onujayi dynamic validation ----------
    const settings = await getStoreSettings(parsedData.storeId);
    const { errors, data, usesVariants } = validateProductBySettings(
      settings,
      body,
    );
    if (errors.length) {
      return res
        .status(400)
        .json({ success: false, message: "Validation failed", errors });
    }

    // ---------- MAIN PRODUCT IMAGE (mode nirbishese sob somoy upload hobe) ----------
    data.images = await uploadSimpleImages(req.files);

    // ---------- VARIANT (COLOR) IMAGE (shudhu hasColor thakle) ----------
    if (settings.hasColor) {
      const variantImageMap = await uploadVariantImages(req.files);
      data.variants = (data.variants || []).map((v, idx) => ({
        ...v,
        images: [...(v.images || []), ...(variantImageMap[idx] || [])],
      }));
    }

    const product = await ProductModel.create({
      name: parsedData.name,
      description: parsedData.description,
      unit: parsedData.unit,
      deliveryTime: parsedData.deliveryTime,
      storeId: parsedData.storeId,
      categoryId: parsedData.categoryId,
      userId,
      isVerified: true,
      hasVariants: settings.hasVariants,
      hasColor: settings.hasColor,
      hasStockManagement: settings.hasStockManagement,
      ...data,
    });

    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
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
      return res
        .status(400)
        .json({ success: false, message: "Validation failed", errors });
    }
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Product with this name already exists",
      });
    }
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

const getAllProducts = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";

    const matchStage = {
      userId: new mongoose.Types.ObjectId(userId),
    };

    if (search) {
      matchStage.$or = [
        { name: { $regex: search, $options: "i" } },
        { productCode: { $regex: search, $options: "i" } },
      ];
    }

    const pipeline = [
      { $match: matchStage },

      {
        $lookup: {
          from: "stores",
          localField: "storeId",
          foreignField: "_id",
          as: "store",
        },
      },
      { $unwind: { path: "$store", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "categories",
          localField: "categoryId",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          name: 1,
          productCode: 1,
          images: 1,
          description: 1,
          unit: 1,
          variants: 1,
          mrp: 1,
          offerPrice: 1,
          stock: 1,
          hasVariants: 1,
          hasColor: 1,
          hasStockManagement: 1,
          minOfferPrice: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$variants", []] } }, 0] },
              { $min: "$variants.offerPrice" },
              "$offerPrice",
            ],
          },
          maxOfferPrice: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$variants", []] } }, 0] },
              { $max: "$variants.offerPrice" },
              "$offerPrice",
            ],
          },
          deliveryTime: 1,
          isActive: 1,
          isVerified: 1,
          storeId: 1,
          categoryId: 1,
          userId: 1,
          createdAt: 1,
          store: {
            _id: "$store._id",
            storeName: "$store.storeName",
            storeUniqueId: "$store.storeUniqueId",
            contactNo: "$store.contactNo",
            whatsappNo: "$store.whatsappNo",
            email: "$store.email",
            isActive: "$store.isActive",
            isVerify: "$store.isVerify",
          },
          category: {
            _id: "$category._id",
            name: "$category.name",
          },
        },
      },

      { $sort: { createdAt: -1 } },

      {
        $facet: {
          data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const result = await ProductModel.aggregate(pipeline);

    const products = result[0]?.data || [];
    const totalProducts = result[0]?.totalCount[0]?.count || 0;
    const totalPages = Math.ceil(totalProducts / limit);

    return res.status(200).json({
      success: true,
      page,
      limit,
      totalPages,
      totalProducts,
      products,
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
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
        .json({ success: false, message: "Only STORE can update product" });
    }

    const existingProduct = await ProductModel.findOne({ _id: id, userId });
    if (!existingProduct) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    const body = { ...req.body };
    if (typeof body.variants === "string") {
      try {
        body.variants = JSON.parse(body.variants);
      } catch {
        return res
          .status(400)
          .json({ success: false, message: "Invalid variants format" });
      }
    }

    const parsedData = updateProductSchema.parse(body);

    if (parsedData.name) {
      const duplicate = await ProductModel.findOne({
        name: { $regex: `^${parsedData.name}$`, $options: "i" },
        userId,
        _id: { $ne: id },
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: [{ field: "name", message: "Product name already exists" }],
        });
      }
    }

    if (parsedData.categoryId) {
      const category = await CategoryModel.findOne({
        _id: parsedData.categoryId,
        storeId: existingProduct.storeId,
      });
      if (!category) {
        return res.status(404).json({
          success: false,
          message: "Category not found for this store",
        });
      }
    }

    const settings = {
      hasVariants: existingProduct.hasVariants,
      hasColor: existingProduct.hasColor,
      hasStockManagement: existingProduct.hasStockManagement,
    };

    // ---------- MAIN PRODUCT IMAGE (mode nirbishese sob somoy update hobe) ----------
    // "images" field e frontend theke remaining existing URL gulo (string) ashe
    // r notun file gulo "image0","image1"... fieldname diye
    const existingMainImages = body.images
      ? Array.isArray(body.images)
        ? body.images
        : [body.images]
      : [];
    const newMainImages = await uploadSimpleImages(req.files);
    const finalMainImages = [...existingMainImages, ...newMainImages];

    let updateData = { ...parsedData, images: finalMainImages };

    const isPricingUpdate =
      body.variants !== undefined ||
      body.mrp !== undefined ||
      body.offerPrice !== undefined ||
      body.stock !== undefined;

    if (isPricingUpdate) {
      const { errors, data, usesVariants } = validateProductBySettings(
        settings,
        body,
      );
      if (errors.length) {
        return res
          .status(400)
          .json({ success: false, message: "Validation failed", errors });
      }

      if (existingProduct.hasColor) {
        const variantImageMap = await uploadVariantImages(req.files);
        data.variants = (data.variants || []).map((v, idx) => ({
          ...v,
          images: [...(v.images || []), ...(variantImageMap[idx] || [])],
        }));
      }

      updateData = { ...updateData, ...data, images: finalMainImages };
    } else if (existingProduct.hasColor && req.files?.length) {
      const variantImageMap = await uploadVariantImages(req.files);
      if (Object.keys(variantImageMap).length) {
        updateData.variants = (existingProduct.variants || []).map(
          (v, idx) => {
            const obj = v.toObject ? v.toObject() : v;
            return {
              ...obj,
              images: [...(obj.images || []), ...(variantImageMap[idx] || [])],
            };
          },
        );
      }
    }

    const updatedProduct = await ProductModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true },
    );

    return res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: updatedProduct,
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
      return res
        .status(400)
        .json({ success: false, message: "Validation failed", errors });
    }
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await ProductModel.findById(id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    await ProductModel.findByIdAndDelete(id);
    return res.status(200).json({ message: "Product deleted permanently" });
  } catch (error) {
    console.error("Delete Product Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const getSingleProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await ProductModel.findOne({ _id: id, isActive: true })
      .populate("storeId", "storeName storeUniqueId contactNo whatsappNo email")
      .populate("categoryId", "name");

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    return res
      .status(200)
      .json({ message: "Product get successfully", product });
  } catch (error) {
    console.error("Get Single Product Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const verifyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isVerify } = req.body;
    if (!id) {
      return res.status(400).json({ message: "Product ID is required" });
    }

    const product = await ProductModel.findById(id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    product.isVerified = isVerify;
    await product.save();

    const store = await StoreModel.findById(product.storeId);
    const user = await UserModel.findById(product.userId);

    if (isVerify && user?.email && store) {
      await sendProductVerifyEmail(
        user.email,
        product.name,
        store.storeName,
        store.storeUniqueId,
      );
    }

    return res.json({
      success: true,
      message:
        "Product is " +
        (isVerify ? "verified" : "not verified") +
        " successfully",
    });
  } catch (error) {
    console.error("Verify error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

const allProductWithStore = async (req, res) => {
  try {
    const products = await ProductModel.aggregate([
      { $match: {} },

      {
        $lookup: {
          from: "stores",
          localField: "storeId",
          foreignField: "_id",
          as: "store",
        },
      },
      { $unwind: { path: "$store", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "categories",
          localField: "categoryId",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          name: 1,
          productCode: 1,
          images: 1,
          description: 1,
          unit: 1,
          variants: 1,
          minOfferPrice: { $min: "$variants.offerPrice" },
          maxOfferPrice: { $max: "$variants.offerPrice" },
          deliveryTime: 1,

          isActive: 1,
          isVerified: 1,

          storeId: 1,
          categoryId: 1,
          userId: 1,

          createdAt: 1,
          updatedAt: 1,

          store: {
            _id: "$store._id",
            storeName: "$store.storeName",
            storeUniqueId: "$store.storeUniqueId",
            contactNo: "$store.contactNo",
            whatsappNo: "$store.whatsappNo",
            email: "$store.email",
            website: "$store.website",
            isActive: "$store.isActive",
            isVerify: "$store.isVerify",
          },
          category: {
            _id: "$category._id",
            name: "$category.name",
          },
        },
      },

      { $sort: { createdAt: -1 } },
    ]);

    return res.json({ success: true, count: products.length, products });
  } catch (error) {
    console.error("Dropdown Products Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// ...............Public controller for product................

const escapeRegex = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PUBLIC_STORE_FIELDS =
  "storeName storeType storeUniqueId images address lat long contactNo whatsappNo supportNo email description timingByDay isFeatured";

const PRODUCT_LIST_FIELDS =
  "name productCode images description unit variants deliveryTime storeId categoryId createdAt";

const SORT_MAP = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name_asc: { name: 1 },
  name_desc: { name: -1 },
};

const getPagination = (query) => {
  const page = Math.max(parseInt(query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit) || 12, 1), 50);
  return { page, limit, skip: (page - 1) * limit };
};

const toPositiveNumber = (value) => {
  if (value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
};

const getPublicStore = (storeUniqueId) =>
  StoreModel.findOne({ storeUniqueId, isActive: true })
    .select(PUBLIC_STORE_FIELDS)
    .lean();

const formatProduct = ({ categoryId, ...product }) => ({
  ...product,
  categoryId: categoryId?._id ?? null,
  category: categoryId?._id
    ? { _id: categoryId._id, name: categoryId.name }
    : null,
});

const fetchStoreProducts = async (store, query, categoryId) => {
  const { page, limit, skip } = getPagination(query);

  const match = {
    storeId: store._id,
    isActive: true,
    isVerified: true,
  };

  if (categoryId) {
    match.categoryId = new mongoose.Types.ObjectId(categoryId);
  }

  const search = (query.search || "").trim();
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    match.$or = [{ name: regex }, { productCode: regex }];
  }

  const minPrice = toPositiveNumber(query.minPrice);
  const maxPrice = toPositiveNumber(query.maxPrice);

  const pipeline = [{ $match: match }];

  if (minPrice !== null || maxPrice !== null) {
    const priceRange = {};
    if (minPrice !== null) priceRange.$gte = minPrice;
    if (maxPrice !== null) priceRange.$lte = maxPrice;

    pipeline.push({
      $match: {
        $or: [
          {
            variants: {
              $elemMatch: { offerPrice: priceRange, isActive: true },
            },
          },
          { $and: [{ variants: { $size: 0 } }, { offerPrice: priceRange }] },
        ],
      },
    });
  }

  pipeline.push({
    $addFields: {
      minOfferPrice: {
        $cond: [
          { $gt: [{ $size: { $ifNull: ["$variants", []] } }, 0] },
          { $min: "$variants.offerPrice" },
          "$offerPrice",
        ],
      },
    },
  });

  let sort;
  if (query.sortBy === "price_asc") sort = { minOfferPrice: 1, _id: -1 };
  else if (query.sortBy === "price_desc") sort = { minOfferPrice: -1, _id: -1 };
  else sort = { ...(SORT_MAP[query.sortBy] || SORT_MAP.newest), _id: -1 };

  pipeline.push(
    { $sort: sort },
    {
      $facet: {
        data: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: "categories",
              localField: "categoryId",
              foreignField: "_id",
              as: "categoryId",
            },
          },
          {
            $unwind: { path: "$categoryId", preserveNullAndEmptyArrays: true },
          },
          {
            $project: {
              name: 1,
              productCode: 1,
              images: 1,
              description: 1,
              unit: 1,
              variants: 1,
              mrp: 1,
              offerPrice: 1,
              stock: 1,
              hasVariants: 1,
              hasColor: 1,
              hasStockManagement: 1,
              minOfferPrice: 1,
              deliveryTime: 1,
              storeId: 1,
              categoryId: { _id: 1, name: 1 },
              createdAt: 1,
            },
          },
        ],
        totalCount: [{ $count: "count" }],
      },
    },
  );

  const [result] = await ProductModel.aggregate(pipeline);
  const products = result?.data || [];
  const totalProducts = result?.totalCount?.[0]?.count || 0;
  const totalPages = Math.ceil(totalProducts / limit);

  return {
    page,
    limit,
    totalPages,
    totalProducts,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    products: products.map(formatProduct),
  };
};

const getStoreCategories = async (req, res) => {
  try {
    const { storeUniqueId } = req.params;

    const store = await getPublicStore(storeUniqueId);
    if (!store) {
      return res
        .status(404)
        .json({ success: false, message: "Store not found" });
    }

    const match = { storeId: store._id, isActive: true };

    const search = (req.query.search || "").trim();
    if (search) {
      match.name = { $regex: escapeRegex(search), $options: "i" };
    }

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: "products",
          let: { catId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$categoryId", "$$catId"] },
                isActive: true,
                isVerified: true,
              },
            },
            { $count: "count" },
          ],
          as: "productStats",
        },
      },
      {
        $addFields: {
          productCount: {
            $ifNull: [{ $arrayElemAt: ["$productStats.count", 0] }, 0],
          },
        },
      },
      {
        $project: {
          name: 1,
          description: 1,
          image: 1,
          icon: 1,
          productCount: 1,
          createdAt: 1,
        },
      },
    ];

    if (req.query.includeEmpty !== "true") {
      pipeline.push({ $match: { productCount: { $gt: 0 } } });
    }

    pipeline.push({ $sort: { name: 1 } });

    const categories = await CategoryModel.aggregate(pipeline);

    return res.status(200).json({
      success: true,
      store,
      count: categories.length,
      categories,
    });
  } catch (error) {
    console.error("Get Store Categories Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

const getStoreProducts = async (req, res) => {
  try {
    const { storeUniqueId } = req.params;
    const { categoryId } = req.query;

    if (categoryId && !mongoose.isValidObjectId(categoryId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid category id" });
    }

    const store = await getPublicStore(storeUniqueId);
    if (!store) {
      return res
        .status(404)
        .json({ success: false, message: "Store not found" });
    }

    const match = {
      storeId: store._id,
      isActive: true,
      isVerified: true,
    };

    if (categoryId) {
      match.categoryId = new mongoose.Types.ObjectId(categoryId);
    }

    const search = (req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      match.$or = [{ name: regex }, { productCode: regex }];
    }

    let products = await ProductModel.find(match)
      .select(
        `${PRODUCT_LIST_FIELDS} mrp offerPrice stock hasVariants hasColor hasStockManagement reviews averageRating totalReviews`,
      )
      .populate("categoryId", "name")
      .populate({ path: "reviews.userId", select: "name picture" })
      .lean();

    const minPrice = toPositiveNumber(req.query.minPrice);
    const maxPrice = toPositiveNumber(req.query.maxPrice);
    if (minPrice !== null || maxPrice !== null) {
      products = products.filter((p) => {
        if (p.variants?.length) {
          return p.variants.some(
            (v) =>
              v.isActive !== false &&
              (minPrice === null || v.offerPrice >= minPrice) &&
              (maxPrice === null || v.offerPrice <= maxPrice),
          );
        }
        if (p.offerPrice === undefined || p.offerPrice === null) return false;
        return (
          (minPrice === null || p.offerPrice >= minPrice) &&
          (maxPrice === null || p.offerPrice <= maxPrice)
        );
      });
    }

    products = products.map((p) => {
      const minOfferPrice = p.variants?.length
        ? Math.min(...p.variants.map((v) => v.offerPrice))
        : (p.offerPrice ?? null);

      const reviews = p.reviews || [];
      const maxReview =
        reviews.length > 0
          ? [...reviews].sort((a, b) => b.rating - a.rating)[0]
          : null;

      return {
        ...formatProduct(p),
        minOfferPrice,
        reviews,
        maxReview,
      };
    });

    const sortBy = req.query.sortBy;
    if (sortBy === "price_asc") {
      products.sort((a, b) => (a.minOfferPrice ?? 0) - (b.minOfferPrice ?? 0));
    } else if (sortBy === "price_desc") {
      products.sort((a, b) => (b.minOfferPrice ?? 0) - (a.minOfferPrice ?? 0));
    } else if (sortBy === "name_asc") {
      products.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "name_desc") {
      products.sort((a, b) => b.name.localeCompare(a.name));
    } else if (sortBy === "oldest") {
      products.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else {
      products.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    return res.status(200).json({
      success: true,
      store,
      count: products.length,
      products,
    });
  } catch (error) {
    console.error("Get Store Products Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

const getStoreProductsByCategory = async (req, res) => {
  try {
    const { storeUniqueId, categoryId } = req.params;

    if (!mongoose.isValidObjectId(categoryId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid category id" });
    }

    const store = await getPublicStore(storeUniqueId);
    if (!store) {
      return res
        .status(404)
        .json({ success: false, message: "Store not found" });
    }

    const category = await CategoryModel.findOne({
      _id: categoryId,
      storeId: store._id,
      isActive: true,
    })
      .select("name description")
      .lean();

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found for this store",
      });
    }

    const result = await fetchStoreProducts(store, req.query, category._id);

    return res.status(200).json({ success: true, store, category, ...result });
  } catch (error) {
    console.error("Get Store Products By Category Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

const getStoreSingleProduct = async (req, res) => {
  try {
    const { storeUniqueId, productId } = req.params;

    if (!mongoose.isValidObjectId(productId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid product id" });
    }

    const store = await getPublicStore(storeUniqueId);
    if (!store) {
      return res
        .status(404)
        .json({ success: false, message: "Store not found" });
    }

    const product = await ProductModel.findOne({
      _id: productId,
      storeId: store._id,
      isActive: true,
      isVerified: true,
    })
      .select("-userId -__v")
      .populate("categoryId", "name")
      .lean();

    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    const categoryId = product.categoryId?._id;
    const relatedProducts = categoryId
      ? await ProductModel.find({
          storeId: store._id,
          categoryId,
          _id: { $ne: product._id },
          isActive: true,
          isVerified: true,
        })
          .select(PRODUCT_LIST_FIELDS)
          .sort({ createdAt: -1 })
          .limit(8)
          .lean()
      : [];

    return res.status(200).json({
      success: true,
      store,
      product: formatProduct(product),
      relatedProducts,
    });
  } catch (error) {
    console.error("Get Store Single Product Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

module.exports = {
  createProduct,
  getAllProducts,
  getSingleProduct,
  updateProduct,
  deleteProduct,
  allProductWithStore,
  verifyStatus,
  getStoreCategories,
  getStoreProducts,
  getStoreProductsByCategory,
  getStoreSingleProduct,
};