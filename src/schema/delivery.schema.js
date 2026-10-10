const { z } = require("zod");

const pincodeField = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, "Enter a valid 6 digit pincode");

const saveDeliverySettingsSchema = z
  .object({
    storeId: z.string().min(1, "Store is required"),
    deliveryType: z.enum(["LOCAL", "NATIONAL", "BOTH"]),
    pincode: pincodeField,
    radiusKm: z.coerce.number().positive().max(500).optional(),
    localDeliveryDays: z.coerce.number().int().min(0).max(30).optional(),
    nationalMinDays: z.coerce.number().int().min(0).max(60).optional(),
    nationalMaxDays: z.coerce.number().int().min(0).max(60).optional(),
    handlingDays: z.coerce.number().int().min(0).max(30).optional(),
  })
  .superRefine((d, ctx) => {
    const needsLocal = d.deliveryType === "LOCAL" || d.deliveryType === "BOTH";
    const needsNational =
      d.deliveryType === "NATIONAL" || d.deliveryType === "BOTH";

    if (needsLocal) {
      if (d.radiusKm === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["radiusKm"],
          message: "Delivery radius is required for local delivery",
        });
      }
      if (d.localDeliveryDays === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["localDeliveryDays"],
          message: "Local delivery days is required",
        });
      }
    }

    if (needsNational) {
      if (d.nationalMinDays === undefined || d.nationalMaxDays === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["nationalMinDays"],
          message: "National delivery min and max days are required",
        });
      } else if (d.nationalMaxDays < d.nationalMinDays) {
        ctx.addIssue({
          code: "custom",
          path: ["nationalMaxDays"],
          message: "Max days cannot be less than min days",
        });
      }
    }
  });

module.exports = { saveDeliverySettingsSchema };