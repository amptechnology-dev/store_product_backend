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
const { validateProduct } = require("../helper/validateProduct.js");
const {
  uploadSimpleImages,
  uploadVariantImages,
} = require("../helper/productImages.js");

// ---------- Reusable aggregation stage: flatten offerPrice from variants + nested sizeVariants ----------
const buildOfferPriceStages = () => [
  {
    $addFields: {
      allOfferPrices: {
        $reduce: {
          input: { $ifNull: ["$variants", []] },
          initialValue: [],
          in: {
            $concatArrays: [
              "$$value",
              {
                $cond: [
                  {
                    $gt: [
                      { $size: { $ifNull: ["$$this.sizeVariants", []] } },
                      0,
                    ],
                  },
                  "$$this.sizeVariants.offerPrice",
                  {
                    $cond: [
                      { $ne: [{ $ifNull: ["$$this.offerPrice", null] }, null] },
                      ["$$this.offerPrice"],
                      [],
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    },
  },
  {
    $addFields: {
      minOfferPrice: {
        $cond: [
          { $gt: [{ $size: "$allOfferPrices" }, 0] },
          { $min: "$allOfferPrices" },
          "$offerPrice",
        ],
      },
      maxOfferPrice: {
        $cond: [
          { $gt: [{ $size: "$allOfferPrices" }, 0] },
          { $max: "$allOfferPrices" },
          "$offerPrice",
        ],
      },
    },
  },
];

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
    if (typeof body.packagingDetails === "string") {
      try {
        body.packagingDetails = JSON.parse(body.packagingDetails);
      } catch {
        return res
          .status(400)
          .json({ success: false, message: "Invalid packagingDetails format" });
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

    const { errors, data, hasVariants, hasColor } = validateProduct(body);
    if (errors.length) {
      return res
        .status(400)
        .json({ success: false, message: "Validation failed", errors });
    }

    data.images = await uploadSimpleImages(req.files);

    if (hasColor) {
      const colorImageMap = await uploadVariantImages(req.files);
      data.variants = (data.variants || []).map((colorVariant, idx) => ({
        ...colorVariant,
        images: [...(colorVariant.images || []), ...(colorImageMap[idx] || [])],
      }));
    }

    const product = await ProductModel.create({
      name: parsedData.name,
      description: parsedData.description,
      unit: parsedData.unit,
      storeId: parsedData.storeId,
      categoryId: parsedData.categoryId,
      userId,
      isVerified: true,
      hasVariants,
      hasColor,
      hasStockManagement: true,
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

      // ---------- FIX: minOfferPrice/maxOfferPrice ekhon nested sizeVariants o dekhe ----------
      ...buildOfferPriceStages(),

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
          maxOfferPrice: 1,
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

const applyOpeningStockDelta = (
  existingOpeningStock,
  existingCurrentStock,
  newOpeningStock,
) => {
  const oldOpening = Number(existingOpeningStock || 0);
  const oldCurrent = Number(existingCurrentStock || 0);
  const newOpening = Number(newOpeningStock);
  const delta = newOpening - oldOpening; // + hole restock, - hole reduce
  return {
    openingStock: newOpening,
    currentStock: Math.max(0, oldCurrent + delta),
  };
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
    if (typeof body.packagingDetails === "string") {
      try {
        body.packagingDetails = JSON.parse(body.packagingDetails);
      } catch {
        return res
          .status(400)
          .json({ success: false, message: "Invalid packagingDetails format" });
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

    // ---------- MAIN PRODUCT IMAGE ----------
    const existingMainImages = body.images
      ? Array.isArray(body.images)
        ? body.images
        : [body.images]
      : [];
    const newMainImages = await uploadSimpleImages(req.files);
    const finalMainImages = [...existingMainImages, ...newMainImages];

    let updateData = { ...parsedData, images: finalMainImages };

    // variants/pricing/stock somporkito kono field ashle notun kore structure decide hobe
    const isStructuralUpdate =
      body.variants !== undefined ||
      body.mrp !== undefined ||
      body.offerPrice !== undefined ||
      body.openingStock !== undefined;

    if (isStructuralUpdate) {
      const { errors, data, hasVariants, hasColor } = validateProduct(body);
      if (errors.length) {
        return res
          .status(400)
          .json({ success: false, message: "Validation failed", errors });
      }

      if (hasColor) {
        const colorImageMap = await uploadVariantImages(req.files);
        data.variants = (data.variants || []).map((colorVariant, idx) => ({
          ...colorVariant,
          images: [
            ...(colorVariant.images || []),
            ...(colorImageMap[idx] || []),
          ],
        }));
      }

      // ---------- Stock: delta logic, existing sold stock na hariye ----------
      if (!hasVariants) {
        // simple product
        if (body.openingStock !== undefined) {
          Object.assign(
            data,
            applyOpeningStockDelta(
              existingProduct.openingStock,
              existingProduct.currentStock,
              body.openingStock,
            ),
          );
        } else {
          // openingStock notun kore deyni -> purono stock retain
          data.openingStock = existingProduct.openingStock;
          data.currentStock = existingProduct.currentStock;
        }
      } else {
        // variant/color level e - proti variant-er jonno existing match kore delta lagano
        const existingFlat = [];
        (existingProduct.variants || []).forEach((v) => {
          if (Array.isArray(v.sizeVariants) && v.sizeVariants.length) {
            v.sizeVariants.forEach((sv) => existingFlat.push(sv));
          } else {
            existingFlat.push(v);
          }
        });

        let flatIdx = 0;
        const applyToVariant = (variant) => {
          const prev = existingFlat[flatIdx];
          flatIdx += 1;
          if (prev && variant.openingStock !== undefined) {
            Object.assign(
              variant,
              applyOpeningStockDelta(
                prev.openingStock,
                prev.currentStock,
                variant.openingStock,
              ),
            );
          } else if (prev) {
            variant.openingStock = prev.openingStock;
            variant.currentStock = prev.currentStock;
          }
        };

        data.variants.forEach((v) => {
          if (Array.isArray(v.sizeVariants) && v.sizeVariants.length) {
            v.sizeVariants.forEach(applyToVariant);
          } else {
            applyToVariant(v);
          }
        });
      }

      updateData = {
        ...updateData,
        ...data,
        images: finalMainImages,
        hasVariants,
        hasColor,
      };
    } else if (existingProduct.hasColor && req.files?.length) {
      // sudhu notun color-image add hocche, pricing/stock change hocche na
      const colorImageMap = await uploadVariantImages(req.files);
      if (Object.keys(colorImageMap).length) {
        updateData.variants = (existingProduct.variants || []).map((v, idx) => {
          const obj = v.toObject ? v.toObject() : v;
          return {
            ...obj,
            images: [...(obj.images || []), ...(colorImageMap[idx] || [])],
          };
        });
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

      // ---------- FIX: minOfferPrice/maxOfferPrice ekhon nested sizeVariants o dekhe ----------
      ...buildOfferPriceStages(),

      {
        $project: {
          name: 1,
          productCode: 1,
          images: 1,
          description: 1,
          unit: 1,
          variants: 1,
          minOfferPrice: 1,
          maxOfferPrice: 1,
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

  // ---------- FIX: minOfferPrice ekhon nested sizeVariants soho calculate hoy, tai price-filter ekhon age na kore ei stage-er pore kora hocche ----------
  pipeline.push(...buildOfferPriceStages());

  if (minPrice !== null || maxPrice !== null) {
    const priceRange = {};
    if (minPrice !== null) priceRange.$gte = minPrice;
    if (maxPrice !== null) priceRange.$lte = maxPrice;

    const cmp = {};
    if (minPrice !== null) cmp.$gte = ["$maxOfferPrice", minPrice];
    if (maxPrice !== null) cmp.$lte = ["$minOfferPrice", maxPrice];

    pipeline.push({
      $match: {
        $expr:
          minPrice !== null && maxPrice !== null
            ? { $and: [{ $gte: ["$maxOfferPrice", minPrice] }, { $lte: ["$minOfferPrice", maxPrice] }] }
            : minPrice !== null
              ? { $gte: ["$maxOfferPrice", minPrice] }
              : { $lte: ["$minOfferPrice", maxPrice] },
      },
    });
  }

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

    // ---------- FIX: flat helper to get offerPrice list for a product (color+sizeVariants soho) ----------
    const getOfferPrices = (p) => {
      const prices = [];
      (p.variants || []).forEach((v) => {
        if (Array.isArray(v.sizeVariants) && v.sizeVariants.length) {
          v.sizeVariants.forEach((sv) => {
            if (sv.offerPrice !== undefined && sv.offerPrice !== null)
              prices.push(sv.offerPrice);
          });
        } else if (v.offerPrice !== undefined && v.offerPrice !== null) {
          prices.push(v.offerPrice);
        }
      });
      if (!prices.length && p.offerPrice !== undefined && p.offerPrice !== null) {
        prices.push(p.offerPrice);
      }
      return prices;
    };

    const minPrice = toPositiveNumber(req.query.minPrice);
    const maxPrice = toPositiveNumber(req.query.maxPrice);
    if (minPrice !== null || maxPrice !== null) {
      products = products.filter((p) => {
        const prices = getOfferPrices(p);
        if (!prices.length) return false;
        return prices.some(
          (price) =>
            (minPrice === null || price >= minPrice) &&
            (maxPrice === null || price <= maxPrice),
        );
      });
    }

    products = products.map((p) => {
      const prices = getOfferPrices(p);
      const minOfferPrice = prices.length ? Math.min(...prices) : null;

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