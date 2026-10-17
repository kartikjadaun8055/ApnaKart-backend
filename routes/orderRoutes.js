const express = require("express");
const router = express.Router();
const{protect} = require('../middleware/authMiddleware');
const  {admin} = require('../middleware/adminMiddleware');
const{getOrders, createOrder, updateOrderStatus, myOrder, cancelOrder} = require("../controller/orderController")




router.route('/').post(protect, createOrder).get(protect, admin, getOrders);
router.route('/myOrders').get(protect, myOrder);
router.route('/:id/cancel').post(protect, admin, cancelOrder);
router.route('/:id/status').put(protect, admin, updateOrderStatus);

module.exports = router;