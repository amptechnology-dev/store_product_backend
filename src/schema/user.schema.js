const { z } = require("zod");

// registration er shomoy user er address required
const addressSchema = z.object({
  addressLine: z.string().trim().min(1, "Address line is required"),
  area: z.string().trim().optional(),
  city: z.string().trim().min(1, "City is required"),
  state: z.string().trim().min(1, "State is required"),
  pincode: z.string().trim().min(4, "Valid pincode is required"),
  country: z.string().trim().optional(),
});

const createUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),

  email: z.string().email("Invalid email format").toLowerCase(),

  phone: z
    .string()
    .min(10, "Phone number must be at least 10 digits")
    .max(11, "Phone number too long")
    .optional(),

  password: z.string().min(6, "Password must be at least 6 characters"),

  role: z.enum(["ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"]).optional(),

  isActive: z.boolean().optional(),

  // ✅ NEW: registration er shomoy required
  address: addressSchema,
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),

  email: z.string().email().toLowerCase().optional(),

  phone: z.string().min(10).max(15).optional(),

  role: z.enum(["ADMIN", "STORE"]).optional(),

  isActive: z.boolean().optional(),

  // update e address change korte chaile partial-o allow kora hocche
  address: addressSchema.partial().optional(),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email"),

  password: z.string().min(6, "Password is required"),
});

module.exports = {
  createUserSchema,
  updateUserSchema,
  loginSchema,
};
