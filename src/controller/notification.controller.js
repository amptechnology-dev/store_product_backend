const NotificationModel = require("../model/notification.model.js");
const StoreModel = require("../model/store.model.js");

const getUserId = (req) => req.user?._id || req.user?.id;

const getOwnedStoreIds = async (userId) => {
  const stores = await StoreModel.find({ userId }).select("_id").lean();
  return stores.map((s) => s._id);
};

const saveFcmToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: "Token required" });
    }

    const ownedStoreIds = await getOwnedStoreIds(getUserId(req));
    await StoreModel.updateMany(
      { _id: { $in: ownedStoreIds } },
      { $addToSet: { fcmTokens: token } },
    );

    return res.status(200).json({ success: true, message: "Token registered" });
  } catch (error) {
    console.error("saveFcmToken:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const getNotifications = async (req, res) => {
  try {
    const ownedStoreIds = await getOwnedStoreIds(getUserId(req));
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const [notifications, unreadCount] = await Promise.all([
      NotificationModel.find({ storeId: { $in: ownedStoreIds } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      NotificationModel.countDocuments({ storeId: { $in: ownedStoreIds }, isRead: false }),
    ]);

    return res.status(200).json({ success: true, notifications, unreadCount });
  } catch (error) {
    console.error("getNotifications:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const markNotificationsRead = async (req, res) => {
  try {
    const ownedStoreIds = await getOwnedStoreIds(getUserId(req));
    const { notificationIds } = req.body || {}; 

    const filter = { storeId: { $in: ownedStoreIds }, isRead: false };
    if (notificationIds?.length) filter._id = { $in: notificationIds };

    await NotificationModel.updateMany(filter, { $set: { isRead: true } });
    return res.status(200).json({ success: true, message: "Marked as read" });
  } catch (error) {
    console.error("markNotificationsRead:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

module.exports = { saveFcmToken, getNotifications, markNotificationsRead };