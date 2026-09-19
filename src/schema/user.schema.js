const { z } = require("zod");

const createUserSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters"),

  email: z
    .string()
    .email("Invalid email format")
    .toLowerCase(),

  phone: z
    .string()
    .min(10, "Phone number must be at least 10 digits")
    .max(11, "Phone number too long")
    .optional(),

  password: z
    .string()
    .min(6, "Password must be at least 6 characters"),

  role: z
    .enum(["ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"])
    .optional(),

    isActive: z
    .boolean()
    .optional(),

 });

const updateUserSchema = z.object({
  name: z
    .string()
    .min(2)
    .optional(),

  email: z
    .string()
    .email()
    .toLowerCase()
    .optional(),

  phone: z
    .string()
    .min(10)
    .max(15)
    .optional(),

  role: z
    .enum(["ADMIN", "STORE"])
    .optional(),

   isActive: z
    .boolean()
    .optional()
});

const loginSchema = z.object({
  email: z
    .string()
    .email("Invalid email"),

  password: z
    .string()
    .min(6, "Password is required")
});

module.exports = {
  createUserSchema,
  updateUserSchema,
  loginSchema
};