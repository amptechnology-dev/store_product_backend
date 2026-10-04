const mongoose = require("mongoose");
const StoreModel = require("../model/store.model.js");
const StoreVisitModel = require("../model/storeVisit.model.js");
const UserModel = require("../model/user.model.js");
const OrderModel = require("../model/order.model.js"); // tomar order model er path ta check koro

const getUserId = (req) => req.user?._id || req.user?.id;

const escapeRegex = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// POST /api/store-visit
// body: { storeUniqueId: "STR-1790430355162" } ba { storeId: "<mongo id>" }
const registerStoreVisit = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { storeUniqueId, storeId } = req.body || {};

    let filter;
    if (typeof storeUniqueId === "string" && storeUniqueId.trim()) {
      filter = { storeUniqueId: storeUniqueId.trim() };
    } else if (storeId && mongoose.isValidObjectId(storeId)) {
      filter = { _id: storeId };
    } else {
      return res.status(400).json({
        success: false,
        message: "storeUniqueId or valid storeId required",
      });
    }

    const store = await StoreModel.findOne({ ...filter, isActive: true })
      .select("_id")
      .lean();
    if (!store) {
      return res
        .status(404)
        .json({ success: false, message: "Store not found" });
    }

    // prothom bar hole create, nahole shudhu lastVisitedAt update
    await StoreVisitModel.updateOne(
      { userId, storeId: store._id },
      { $set: { lastVisitedAt: new Date() } },
      { upsert: true },
    );

    return res
      .status(200)
      .json({ success: true, message: "Store visit registered" });
  } catch (error) {
    console.error("registerStoreVisit:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// GET /api/store-visit/visitors?page=1&limit=10&search=&storeId=
// STORE owner dekhbe tar store gulo te ke ke visit koreche
const getStoreVisitors = async (req, res) => {
  try {
    const ownerId = getUserId(req);

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);
    const search = String(req.query.search || "").trim();
    const { storeId } = req.query;

    const ownedStores = await StoreModel.find({ userId: ownerId })
      .select("_id")
      .lean();
    let storeIds = ownedStores.map((s) => s._id);

    // specific store filter (shudhu nijer store hole)
    if (storeId) {
      if (!mongoose.isValidObjectId(storeId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid store id" });
      }
      const allowed = storeIds.some((id) => String(id) === String(storeId));
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: "Store not found or not owned by you",
        });
      }
      storeIds = [new mongoose.Types.ObjectId(storeId)];
    }

    if (!storeIds.length) {
      return res.status(200).json({
        success: true,
        page,
        limit,
        totalPages: 0,
        totalVisitors: 0,
        visitors: [],
      });
    }

    const userMatch = { "user.role": "USER" };
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      userMatch.$or = [
        { "user.name": rx },
        { "user.email": rx },
        { "user.phone": rx },
      ];
    }

    const [result] = await StoreVisitModel.aggregate([
      { $match: { storeId: { $in: storeIds } } },
      {
        $lookup: {
          from: UserModel.collection.name,
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      { $match: userMatch },
      {
        $lookup: {
          from: StoreModel.collection.name,
          localField: "storeId",
          foreignField: "_id",
          as: "store",
        },
      },
      { $unwind: "$store" },
      { $sort: { lastVisitedAt: -1, _id: -1 } },
      {
        $facet: {
          data: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              // inclusion projection: password / fcmTokens kokhono ashbe na
              $project: {
                _id: 1,
                lastVisitedAt: 1,
                createdAt: 1,
                "user._id": 1,
                "user.name": 1,
                "user.email": 1,
                "user.phone": 1,
                "user.picture": 1,
                "user.isActive": 1,
                "user.isVerified": 1,
                "store._id": 1,
                "store.storeName": 1,
                "store.storeUniqueId": 1,
              },
            },
          ],
          total: [{ $count: "count" }],
        },
      },
    ]);

    const totalVisitors = result?.total?.[0]?.count || 0;

    return res.status(200).json({
      success: true,
      page,
      limit,
      totalPages: Math.ceil(totalVisitors / limit),
      totalVisitors,
      visitors: result?.data || [],
    });
  } catch (error) {
    console.error("getStoreVisitors:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// GET /api/store-visit/visitors/:visitId
// ekta visitor er full details + oi store e tar order summary
const getVisitorDetails = async (req, res) => {
  try {
    const ownerId = getUserId(req);
    const { visitId } = req.params;

    if (!mongoose.isValidObjectId(visitId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid visit id" });
    }

    const visit = await StoreVisitModel.findById(visitId)
      .populate({
        path: "userId",
        select:
          "name email phone picture role provider address isActive isVerified createdAt",
      })
      .populate({
        path: "storeId",
        select: "storeName storeUniqueId userId",
      })
      .lean();

    // onner store er visitor dekha jabe na
    if (!visit || !visit.userId || String(visit.storeId?.userId) !== String(ownerId)) {
      return res
        .status(404)
        .json({ success: false, message: "Visitor not found" });
    }

    const user = visit.userId;
    const store = visit.storeId;

    const orderFilter = { userId: user._id, storeId: store._id };

    const [statsAgg, recentOrders] = await Promise.all([
      OrderModel.aggregate([
        { $match: orderFilter },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalSpent: {
              $sum: {
                $cond: [
                  { $ne: ["$status", "CANCELLED"] },
                  { $ifNull: ["$totalAmount", 0] },
                  0,
                ],
              },
            },
          },
        },
      ]),
      OrderModel.find(orderFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .select("orderNumber status totalAmount createdAt")
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      visitor: {
        visitId: visit._id,
        firstVisitedAt: visit.createdAt,
        lastVisitedAt: visit.lastVisitedAt,
        user,
        store: {
          _id: store._id,
          storeName: store.storeName,
          storeUniqueId: store.storeUniqueId,
        },
        orderStats: {
          totalOrders: statsAgg[0]?.totalOrders || 0,
          totalSpent: statsAgg[0]?.totalSpent || 0,
        },
        recentOrders,
      },
    });
  } catch (error) {
    console.error("getVisitorDetails:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

module.exports = { registerStoreVisit, getStoreVisitors, getVisitorDetails };