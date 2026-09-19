const router = require("express").Router();

const {
  createCategory,
  allCategories,
  singleCategory,
  updateCategory,
  deleteCategory,
} = require("../controller/category.controller.js");

const verifyJwt = require("../middleware/verifiyUser.js");


router.post("/", verifyJwt, createCategory);

router.get("/", allCategories);

router.get("/:categoryId", singleCategory);

router.put("/:categoryId", verifyJwt, updateCategory);

router.delete("/:categoryId", verifyJwt, deleteCategory);

module.exports = router;