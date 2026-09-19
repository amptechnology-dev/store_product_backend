const AdsModel = require("../model/ads.model");
const ProductModel = require("../model/product.model");
const { uploadToR2 } = require("../helper/upload");

// CREATE ADS

const createAds = async (req, res) => {
  try {
    const { storeId, productId, rank, expiryDate } = req.body;

    const product = await ProductModel.findById(productId);

    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    const ads = await AdsModel.create({
      storeId,
      productId,
      rank: Number(rank),
      expiryDate,
    });

    return res.status(201).json({
      message: "Ads created successfully",
      ads,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// ALL ADS

const allAds = async (req, res) => {
  try {
    const ads = await AdsModel.find({
      isActive: true,
      expiryDate: {
        $gte: new Date(),
      },
    })
      .populate({
        path: "productId",
        populate: {
          path: "storeId",
          select: "storeName",
        },
      })
      .sort({
        rank: 1,
      });

    return res.status(200).json({
      total: ads.length,
      ads,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// ADS BY RANK

const adsByRank = async (req, res) => {
  try {
    const { rank } = req.params;

    const ads = await AdsModel.find({
      rank: Number(rank),
      isActive: true,
      expiryDate: {
        $gte: new Date(),
      },
    }).populate({
      path: "productId",
      populate: {
        path: "storeId",
        select: "storeName",
      },
    });

    return res.status(200).json({
      total: ads.length,
      ads,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// SINGLE ADS

const singleAds = async (req, res) => {
  try {
    const { adsId } = req.params;

    const ads = await AdsModel.findById(adsId)
      .populate({
        path: "productId",
        select:
          "name images description sellingPrice storeId isVerified isActive",
        populate: {
          path: "storeId",
          select:
            "storeName storeUniqueId images address contactNo whatsappNo",
        },
      });

    if (!ads) {
      return res.status(404).json({
        message: "Ads not found",
      });
    }

    return res.status(200).json({
      ads,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// UPDATE ADS

const updateAds = async (req, res) => {
  try {
    const { adsId } = req.params;

    const ads = await AdsModel.findById(adsId);

    if (!ads) {
      return res.status(404).json({
        message: "Ads not found",
      });
    }

    if (req.body.productId) {
      const product = await ProductModel.findById(
        req.body.productId
      );

      if (!product) {
        return res.status(404).json({
          message: "Product not found",
        });
      }

      ads.productId = req.body.productId;
      ads.storeId = product.storeId; 
    }

    if (req.body.rank !== undefined) {
      ads.rank = Number(req.body.rank);
    }

    if (req.body.expiryDate) {
      ads.expiryDate = req.body.expiryDate;
    }

    if (req.body.isActive !== undefined) {
      ads.isActive = req.body.isActive;
    }

    await ads.save();

    return res.status(200).json({
      message: "Ads updated successfully",
      ads,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// DELETE ADS

const deleteAds = async (req, res) => {
  try {
    const { adsId } = req.params;

    await AdsModel.findByIdAndDelete(adsId);

    return res.status(200).json({
      message: "Ads deleted successfully",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

module.exports = {
  createAds,
  allAds,
  adsByRank,
  singleAds,
  updateAds,
  deleteAds,
};
