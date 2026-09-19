const mongoose = require("mongoose");

const User = require("../model/user.model");
const Worker = require("../model/worker.model");
const Product = require("../model/product.model");
const Tank = require("../model/tank.model");
const Nozzle = require("../model/nozzel.model");
const Supplier = require("../model/supplier.model");

const CurrentStock = require("../model/currentStock.model");

const { PurchaseModel } = require("../model/purchase.model");
const SalesModel = require("../model/sales.model");
const TransactionModel = require("../model/transaction.model");

const getDashboard = async (req, res) => {

    try {

        const userId = req.user?._id;
        const role = req.user?.role;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        const objectUserId = new mongoose.Types.ObjectId(userId);

        // ======================
        // DATE FILTERS
        // ======================

        const todayStart = new Date();
        todayStart.setHours(0,0,0,0);

        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0,0,0,0);

        // ======================
        // TOTAL COUNTS
        // ======================

        const countsPromise = Promise.all([

            User.countDocuments({ createdBy: userId }),
            Worker.countDocuments({ createdBy: userId }),
            Product.countDocuments({ userId }),
            Tank.countDocuments({ userId }),
            Nozzle.countDocuments({ userId }),
            Supplier.countDocuments({ userId })

        ]);

        // ======================
        // SALES SUMMARY
        // ======================

        const salesSummaryPromise = SalesModel.aggregate([

            { $match: { userId: objectUserId } },

            {
                $group: {
                    _id: null,
                    totalSales: { $sum: "$totalAmount" },
                    totalLitres: { $sum: "$totalLitres" },
                    totalQty: { $sum: "$totalQty" }
                }
            }

        ]);

        const todaySalesPromise = SalesModel.aggregate([

            {
                $match: {
                    userId: objectUserId,
                    createdAt: { $gte: todayStart }
                }
            },

            {
                $group: {
                    _id: null,
                    total: { $sum: "$totalAmount" }
                }
            }

        ]);

        const monthlySalesPromise = SalesModel.aggregate([

            {
                $match: {
                    userId: objectUserId,
                    createdAt: { $gte: monthStart }
                }
            },

            {
                $group: {
                    _id: null,
                    total: { $sum: "$totalAmount" }
                }
            }

        ]);

        // ======================
        // PURCHASE SUMMARY
        // ======================

        const purchaseSummaryPromise = PurchaseModel.aggregate([

            { $match: { createdBy: objectUserId } },

            {
                $group: {
                    _id: null,
                    totalPurchase: { $sum: "$totalAmount" },
                    totalPaid: { $sum: "$paidAmount" },
                    totalDue: { $sum: "$dueAmount" }
                }
            }

        ]);

        const todayPurchasePromise = PurchaseModel.aggregate([

            {
                $match: {
                    createdBy: objectUserId,
                    purchaseDate: { $gte: todayStart }
                }
            },

            {
                $group: {
                    _id: null,
                    total: { $sum: "$totalAmount" }
                }
            }

        ]);

        const monthlyPurchasePromise = PurchaseModel.aggregate([

            {
                $match: {
                    createdBy: objectUserId,
                    purchaseDate: { $gte: monthStart }
                }
            },

            {
                $group: {
                    _id: null,
                    total: { $sum: "$totalAmount" }
                }
            }

        ]);

        // ======================
        // STOCK SUMMARY
        // ======================

        const stockSummaryPromise = CurrentStock.aggregate([

            { $match: { userId: objectUserId } },

            {
                $group: {
                    _id: null,
                    totalStock: { $sum: "$quantity" }
                }
            }

        ]);

        // ======================
        // INCOME EXPENSE
        // ======================

        const transactionSummaryPromise = TransactionModel.aggregate([

            { $match: { userId: objectUserId } },

            {
                $group: {
                    _id: "$type",
                    total: { $sum: "$amount" }
                }
            }

        ]);

        // ======================
        // RECENT SALES
        // ======================

        const recentSalesPromise = SalesModel.aggregate([

            { $match: { userId: objectUserId } },

            { $sort: { createdAt: -1 } },

            { $limit: 5 },

            {
                $project: {
                    invoiceNumber: 1,
                    totalAmount: 1,
                    totalLitres: 1,
                    createdAt: 1
                }
            }

        ]);

        // ======================
        // RECENT PURCHASES
        // ======================

        const recentPurchasesPromise = PurchaseModel.aggregate([

            { $match: { createdBy: objectUserId } },

            { $sort: { createdAt: -1 } },

            { $limit: 5 },

            {
                $lookup: {
                    from: "suppliers",
                    localField: "supplierId",
                    foreignField: "_id",
                    as: "supplier"
                }
            },

            { $unwind: { path: "$supplier", preserveNullAndEmptyArrays: true } },

            {
                $project: {
                    invoiceNo: 1,
                    totalAmount: 1,
                    purchaseDate: 1,
                    supplierName: "$supplier.name"
                }
            }

        ]);

        // ======================
        // EXECUTE ALL
        // ======================

        const [

            counts,
            salesSummary,
            todaySales,
            monthlySales,
            purchaseSummary,
            todayPurchase,
            monthlyPurchase,
            stockSummary,
            transactionSummary,
            recentSales,
            recentPurchases

        ] = await Promise.all([

            countsPromise,
            salesSummaryPromise,
            todaySalesPromise,
            monthlySalesPromise,
            purchaseSummaryPromise,
            todayPurchasePromise,
            monthlyPurchasePromise,
            stockSummaryPromise,
            transactionSummaryPromise,
            recentSalesPromise,
            recentPurchasesPromise

        ]);

        // ======================
        // FORMAT TRANSACTION
        // ======================

        let income = 0;
        let expense = 0;

        transactionSummary.forEach(t => {

            if (t._id === "INCOME") income = t.total;
            if (t._id === "EXPENSE") expense = t.total;

        });

        // ======================
        // FINAL RESPONSE
        // ======================

        const dashboard = {

            totals: {

                totalUsers: counts[0],
                totalWorkers: counts[1],
                totalProducts: counts[2],
                totalTanks: counts[3],
                totalNozzles: counts[4],
                totalSuppliers: counts[5]

            },

            sales: {

                totalSalesAmount: salesSummary?.[0]?.totalSales || 0,
                totalLitresSold: salesSummary?.[0]?.totalLitres || 0,
                totalProductsSold: salesSummary?.[0]?.totalQty || 0,

                todaySales: todaySales?.[0]?.total || 0,
                monthlySales: monthlySales?.[0]?.total || 0

            },

            purchase: {

                totalPurchaseAmount: purchaseSummary?.[0]?.totalPurchase || 0,
                totalPaid: purchaseSummary?.[0]?.totalPaid || 0,
                totalDue: purchaseSummary?.[0]?.totalDue || 0,

                todayPurchase: todayPurchase?.[0]?.total || 0,
                monthlyPurchase: monthlyPurchase?.[0]?.total || 0

            },

            stock: {

                totalStockQuantity: stockSummary?.[0]?.totalStock || 0

            },

            finance: {

                totalIncome: income,
                totalExpense: expense,
                profit: income - expense

            },

            recentSales,
            recentPurchases

        };

        return res.status(200).json({
            success: true,
            role,
            data: dashboard
        });

    } catch (error) {

        console.error("Dashboard Error:", error);

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

module.exports = { getDashboard };