const { z } = require("zod");

const objectIdSchema = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid ObjectId");

const ORDER_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
];

const deliveryAddressInputSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required"),
  phone: z.string().trim().min(10, "Valid phone number is required"),
  addressLine: z.string().trim().min(1, "Address is required"),
  area: z.string().trim().optional(),
  city: z.string().trim().min(1, "City is required"),
  state: z.string().trim().min(1, "State is required"),
  pincode: z.string().trim().min(4, "Pincode is required"),
  country: z.string().trim().optional(),
});

// ---- Cart theke checkout (multiple store, multiple item) ----
const cartCheckoutSchema = z.object({
  cartId: objectIdSchema,
  storeIds: z.array(objectIdSchema).optional(),
  deliveryAddress: deliveryAddressInputSchema,
  note: z.string().trim().optional(),
  paymentMethod: z.enum(["COD"]).default("COD"),
});

// ---- Product theke direct "Buy Now" (cart chara, ekta product + ekta variant) ----
const directCheckoutSchema = z.object({
  productId: objectIdSchema,
  variantId: objectIdSchema,
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be at least 1")
    .default(1),
  deliveryAddress: deliveryAddressInputSchema,
  note: z.string().trim().optional(),
  paymentMethod: z.enum(["COD"]).default("COD"),
});

const cancelOrderSchema = z.object({
  reason: z.string().trim().optional(),
});

const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().optional(),
});

module.exports = {
  ORDER_STATUSES,
  cartCheckoutSchema,
  directCheckoutSchema,
  cancelOrderSchema,
  updateOrderStatusSchema,
};
