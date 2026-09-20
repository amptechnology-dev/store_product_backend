const { z } = require("zod");

const ORDER_STATUSES = ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED"];

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const deliveryAddressSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required").max(100),
  phone: z.string().trim().regex(/^[0-9+\-\s]{7,15}$/, "Invalid phone number"),
  addressLine: z.string().trim().min(5, "Address is required").max(255),
  area: z.string().trim().max(100).optional(),
  city: z.string().trim().min(1, "City is required").max(100),
  state: z.string().trim().min(1, "State is required").max(100),
  pincode: z.string().trim().regex(/^\d{6}$/, "Invalid pincode"),
  country: z.string().trim().min(1).default("India"),
});

const checkoutSchema = z.object({
  cartId: objectId,
  // na dile cart er shob store er order hobe, dile shudhu ei store gulor
  storeIds: z.array(objectId).min(1).max(20).optional(),
  deliveryAddress: deliveryAddressSchema,
  note: z.string().trim().max(500).optional(),
  paymentMethod: z.enum(["COD"]).default("COD"),
});

const cancelOrderSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

const updateOrderStatusSchema = z.object({
  status: z.enum(["CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED"]),
  note: z.string().trim().max(300).optional(),
});

module.exports = {
  ORDER_STATUSES,
  checkoutSchema,
  cancelOrderSchema,
  updateOrderStatusSchema,
};