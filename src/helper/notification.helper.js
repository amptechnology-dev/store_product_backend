const {
  getMessaging,
  isFirebaseConfigured,
} = require("../config/firebase.admin.js");
const StoreModel = require("../model/store.model.js");
const NotificationModel = require("../model/notification.model.js");

const notifyStore = async ({ order, type, title, body }) => {
  try {
    await NotificationModel.create({
      storeId: order.storeId,
      type,
      title,
      body,
      orderId: order._id,
    });

    if (!isFirebaseConfigured) return;

    const store = await StoreModel.findById(order.storeId)
      .select("fcmTokens")
      .lean();
    if (!store?.fcmTokens?.length) return;

    const response = await getMessaging().sendEachForMulticast({
      notification: { title, body },
      data: { orderId: String(order._id), type },
      tokens: store.fcmTokens,
    });

    const invalidTokens = [];
    response.responses.forEach((r, idx) => {
      if (
        !r.success &&
        [
          "messaging/invalid-registration-token",
          "messaging/registration-token-not-registered",
        ].includes(r.error?.code)
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
    console.error(`notifyStore (${type}) error:`, err);
  }
};

const notifyNewOrder = (order) =>
  notifyStore({
    order,
    type: "NEW_ORDER",
    title: "New Order Received",
    body: `Order #${order.orderNumber} • ₹${order.totalAmount}`,
  });

const notifyOrderCancelled = (order) =>
  notifyStore({
    order,
    type: "ORDER_CANCELLED",
    title: "Order Cancelled",
    body: `Order #${order.orderNumber} was cancelled by the customer`,
  });

module.exports = { notifyNewOrder, notifyOrderCancelled };
