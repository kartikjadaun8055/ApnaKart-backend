const express = require("express");
const { createdOrder, verifyPayment, cancelPayment } = require("../controller/paymentController");
const { protect } = require('../middleware/authMiddleware');
const router = express.Router();




router.post('/order', protect, createdOrder);
router.post('/verify', protect, verifyPayment);
router.post('/cancel', protect, cancelPayment);

module.exports = router;