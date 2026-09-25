const { z } = require("zod");

const updateStoreSettingSchema = z.object({
  hasVariants: z.boolean().optional(),
  hasColor: z.boolean().optional(),
  hasStockManagement: z.boolean().optional(),
});

module.exports = { updateStoreSettingSchema };