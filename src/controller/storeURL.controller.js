const StoreModel = require("../model/store.model.js");
const AppReleaseModel = require("../model/appRelease.model.js");

const getStoreByUniqueId = async (req, res) => {
  try {
    const { storeUniqueId } = req.params;

    if (!storeUniqueId || !storeUniqueId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Store unique id is required",
      });
    }

    const [store] = await StoreModel.aggregate([
      { $match: { storeUniqueId: storeUniqueId.trim() } },
      {
        // active app release (ekta-i), shorashori join
        $lookup: {
          from: AppReleaseModel.collection.name,
          pipeline: [
            { $match: { isActive: true } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            {
              $project: {
                _id: 0,
                appName: 1,
                version: 1,
                apkUrl: 1,
                fileSize: 1,
              },
            },
          ],
          as: "app",
        },
      },
      { $addFields: { app: { $arrayElemAt: ["$app", 0] } } },
      {
        // sensitive field (email, userId, fcmTokens) bad, shudhu public data
        $project: {
          storeUniqueId: 1,
          storeName: 1,
          storeType: 1,
          images: 1,
          isActive: 1,
          isVerify: 1,
          app: 1,
        },
      },
    ]);

    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    // Browser hole HTML, app/API call hole JSON
    const wantsHtml = (req.headers.accept || "").includes("text/html");

    if (wantsHtml) {
      const isAndroid = /android/i.test(req.headers["user-agent"] || "");

      // Android browser + app install nai (install thakle OS nijei app khule dey,
      // ekhane ashe na) -> shorashori APK download
      if (isAndroid && store.app?.apkUrl) {
        res.set("Cache-Control", "no-store"); // notun version upload hole purono redirect cache na hoy
        return res.redirect(302, store.app.apkUrl);
      }

      // iPhone/desktop ba APK upload hoy ni -> fallback page
      return res.render("store-fallback", { store });
    }

    return res.status(200).json({
      success: true,
      message: "Store fetched successfully",
      store,
    });
  } catch (error) {
    console.error("Get Store By Unique Id Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

module.exports = { getStoreByUniqueId };
