const mongoose = require("mongoose");
const StoreModel = require("../model/store.model.js");

const getStoreByUniqueId = async (req, res) => {
  try {
    const { storeUniqueId } = req.params;

    if (!storeUniqueId || !storeUniqueId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Store unique id is required",
      });
    }

    const store = await StoreModel.findOne({
      storeUniqueId: storeUniqueId.trim(),
    }).lean();

    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Store fetched successfully",
      store,
    });
  } catch (error) {
    console.error("Get Store By Unique Id Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

module.exports = {
  getStoreByUniqueId,
};
