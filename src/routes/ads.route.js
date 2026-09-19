const router = require("express").Router();

const verifyJwt = require("../middleware/verifiyUser");
const { uploadMultiImages } = require("../middleware/multiMulter");

const {
  createAds,
  allAds,
  adsByRank,
  singleAds,
  updateAds,
  deleteAds,
} = require("../controller/ads.controller");

router.post("/", verifyJwt, createAds);

router.get("/", allAds);

router.get("/ads-by-rank/:rank", adsByRank);

router.get("/:adsId", singleAds);

router.put("/:adsId", verifyJwt, updateAds);

router.delete("/:adsId", verifyJwt, deleteAds);

module.exports = router;
