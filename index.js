const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
const cors = require("cors");
const Conect = require("./src/db/Connent.js");
const cookieParser = require("cookie-parser");

dotenv.config();

const app = express();
Conect();

app.use(
  cors({
    origin: [process.env.FRONTEND_URL, process.env.FRONTEND_URL_2],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  }),
);
app.use(cookieParser());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const registerRoutes = require("./src/routes/register.routes.js");
const loginRoutes = require("./src/routes/login.routes.js");
const productRoutes = require("./src/routes/product.routes.js");
const dashboardRoutes = require("./src/routes/dashboard.routes.js");
const reviewRoutes = require("./src/routes/review.routes.js");
const categoryRoutes = require("./src/routes/category.routes.js");
const adsRoutes = require("./src/routes/ads.route.js");
const storeActionRoutes = require("./src/routes/storeAction.routes.js");
const cartRoutes = require("./src/routes/cart.routes.js");
const orderRoutes = require("./src/routes/order.routes.js");
const profileRoutes = require("./src/routes/profile.routes.js");
const storeurlroutes = require("./src/routes/storeURL.routes.js");

app.use("/api/register", registerRoutes);
app.use("/api/login", loginRoutes);
app.use("/api/product", productRoutes);
app.use("/api/review", reviewRoutes);
app.use("/api/ads", adsRoutes);
app.use("/api/category", categoryRoutes);
app.use("/api/store-action", storeActionRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/order", orderRoutes);
app.use("/api/profile", profileRoutes);
app.use("/store", storeurlroutes);
// app.use("/api/dashboard", dashboardRoutes)

const port = process.env.PORT || 8090;

app.listen(port, "0.0.0.0", () => {
  console.log(`Server is running on port ${port}`);
});
