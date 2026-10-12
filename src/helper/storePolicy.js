const StoreSettingModel = require("../model/storeSetting.model.js");

const COD_NOT_ALLOWED_MESSAGE = "This store accepts online payment only";

const getStorePolicy = async (storeId) => {
  const s = await StoreSettingModel.findOne({ storeId })
    .select("hasDelivery paymentFirst")
    .lean();

  const hasDelivery = s ? s.hasDelivery !== false : true;
  const paymentFirst = s ? s.paymentFirst === true : false;

  return { hasDelivery, paymentFirst, codAllowed: !paymentFirst };
};

module.exports = { getStorePolicy, COD_NOT_ALLOWED_MESSAGE };
