const StoreSettingModel = require("../model/storeSetting.model.js");

const DEFAULT_SETTINGS = {
  hasVariants: false,
  hasColor: false,
  hasStockManagement: false,
};

// Settings ekhono create na hole default (sob off) return korbe
const getStoreSettings = async (storeId) => {
  const settings = await StoreSettingModel.findOne({ storeId }).lean();
  if (!settings) return { ...DEFAULT_SETTINGS };
  return {
    hasVariants: !!settings.hasVariants,
    hasColor: !!settings.hasColor,
    hasStockManagement: !!settings.hasStockManagement,
  };
};

module.exports = { getStoreSettings, DEFAULT_SETTINGS };