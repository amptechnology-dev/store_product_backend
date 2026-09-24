const { getMessaging } = require("../config/firebase.admin.js"); 
const StoreModel = require("../model/store.model.js");
const NotificationModel = require("../model/notification.model.js");

const notifyNewOrder = async (order) => {
  try {
    await NotificationModel.create({
      storeId: order.storeId,
      type: "NEW_ORDER",
      title: "New Order Received",
      body: `Order #${order.orderNumber} • ₹${order.totalAmount}`,
      orderId: order._id,
    });

    const store = await StoreModel.findById(order.storeId).select("fcmTokens");
    if (!store?.fcmTokens?.length) return;

    const message = {
      notification: {
        title: "New Order Received",
        body: `Order #${order.orderNumber} • ₹${order.totalAmount}`,
      },
      data: {
        orderId: String(order._id),
        type: "NEW_ORDER",
      },
      tokens: store.fcmTokens,
    };

    const response = await getMessaging().sendEachForMulticast(message); 

    const invalidTokens = [];
    response.responses.forEach((r, idx) => {
      if (
        !r.success &&
        ["messaging/invalid-registration-token", "messaging/registration-token-not-registered"].includes(
          r.error?.code,
        )
      ) {
        invalidTokens.push(store.fcmTokens[idx]);
      }
    });
    if (invalidTokens.length) {
      await StoreModel.updateOne(
        { _id: order.storeId },
        { $pull: { fcmTokens: { $in: invalidTokens } } },
      );
    }
  } catch (err) {
    console.error("notifyNewOrder error:", err);
  }
};

module.exports = { notifyNewOrder };