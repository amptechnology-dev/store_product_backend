const StoreSettingModel = require("../model/storeSetting.model.js");

const DEFAULT_SETTINGS = {
  hasStockManagement: false,
};

const getStockManagementEnabled = async (storeId) => {
  const settings = await StoreSettingModel.findOne({ storeId })
    .select("hasStockManagement")
    .lean();
  return settings
    ? Boolean(settings.hasStockManagement)
    : DEFAULT_SETTINGS.hasStockManagement;
};

const isStockManaged = (product) => product?.hasStockManagement !== false;

module.exports = { DEFAULT_SETTINGS, getStockManagementEnabled, isStockManaged };