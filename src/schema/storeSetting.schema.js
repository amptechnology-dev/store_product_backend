const { z } = require("zod");

const updateStoreSettingSchema = z.object({
  hasStockManagement: z.boolean(),
});

module.exports = { updateStoreSettingSchema };