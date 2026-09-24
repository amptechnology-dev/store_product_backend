const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const serviceAccount = require("../../firebase-service-account.json");

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

console.log("Firebase apps initialized:", getApps().length);

module.exports = { getMessaging };