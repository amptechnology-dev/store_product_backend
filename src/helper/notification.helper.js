const {
  getMessaging,
  isFirebaseConfigured,
} = require("../config/firebase.admin.js");
const StoreModel = require("../model/store.model.js");
const NotificationModel = require("../model/notification.model.js");
const UserModel = require("../model/user.model.js");

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

const buildUserNotification = (order) => {
  const n = order.orderNumber;
  switch (order.status) {
    case "PENDING":
      return {
        type: "ORDER_PLACED",
        title: "Order Placed 🎉",
        body: `Your order #${n} has been placed successfully.`,
      };
    case "CONFIRMED":
      return {
        type: "ORDER_CONFIRMED",
        title: "Order Confirmed ✅",
        body: `${order.storeName || "The store"} confirmed your order #${n}.`,
      };
    case "SHIPPED":
      return {
        type: "ORDER_SHIPPED",
        title: "Order Shipped 🚚",
        body: `Your order #${n} is on its way.`,
      };
    case "DELIVERED":
      return {
        type: "ORDER_DELIVERED",
        title: "Order Delivered 📦",
        body: `Your order #${n} has been delivered.`,
      };
    case "CANCELLED": {
      const byStore = order.cancelledBy === "STORE";
      const reason = order.cancelReason ? ` Reason: ${order.cancelReason}` : "";
      return {
        type: "ORDER_CANCELLED",
        title: "Order Cancelled",
        body: byStore
          ? `${order.storeName || "The store"} cancelled your order #${n}.${reason}`
          : `You cancelled your order #${n}.`,
      };
    }
    default:
      return null;
  }
};

const notifyUserOrderStatus = async (order) => {
  try {
    const content = buildUserNotification(order);
    if (!content) return;

    // populateUser: true hole userId object hoye jay
    const userId = order.userId?._id || order.userId;

    await NotificationModel.create({
      userId,
      type: content.type,
      title: content.title,
      body: content.body,
      orderId: order._id,
    });

    if (!isFirebaseConfigured) return;

    const user = await UserModel.findById(userId).select("fcmTokens").lean();
    if (!user?.fcmTokens?.length) return;

    const response = await getMessaging().sendEachForMulticast({
      notification: { title: content.title, body: content.body },
      data: {
        orderId: String(order._id),
        orderNumber: String(order.orderNumber),
        status: String(order.status),
        type: content.type,
      },
      tokens: user.fcmTokens,
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
        invalidTokens.push(user.fcmTokens[idx]);
      }
    });
    if (invalidTokens.length) {
      await UserModel.updateOne(
        { _id: userId },
        { $pull: { fcmTokens: { $in: invalidTokens } } },
      );
    }
  } catch (err) {
    console.error("notifyUserOrderStatus error:", err);
  }
};

module.exports = {
  notifyNewOrder,
  notifyOrderCancelled,
  notifyUserOrderStatus,
};
