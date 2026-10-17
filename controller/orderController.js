const Order = require("../model/Order");
const Product = require("../model/Product");
const mongoose = require("mongoose");
const sendEmail = require("../utils/senEmail");

const restoreStock = async (reservations) => {
  const results = await Promise.allSettled([...reservations].map(([id, quantity]) => Product.updateOne(
    { _id: id },
    { $inc: { stock: quantity } }
  )));
  reservations.clear();

  results.forEach((result) => {
    if (result.status === "rejected") {
      console.error("Stock reservation rollback failed:", result.reason);
    }
  });
};

// Create a new order
const createOrder = async (req, res) => {
  const reservedItems = new Map();
  try {
    const { items, address, paymentMethod = "Cash on Delivery" } = req.body;
    const hasText = (value) => typeof value === "string" && value.trim().length > 0;

    if (
      !Array.isArray(items) ||
      items.length === 0 ||
      !address || typeof address !== "object" || Array.isArray(address) ||
      !hasText(address.fullName) ||
      !hasText(address.street) ||
      !hasText(address.city) ||
      !hasText(address.state) ||
      !hasText(address.country) ||
      !Number.isInteger(Number(address.postalCode)) ||
      Number(address.postalCode) <= 0
    ) {
      return res.status(400).json({ message: "Invalid order data" });
    }

    if (paymentMethod !== "Cash on Delivery") {
      return res.status(400).json({ message: "This payment method is not enabled" });
    }

    const requestedItems = new Map();
    for (const item of items) {
      if (!item || typeof item !== "object") {
        return res.status(400).json({ message: "Invalid order item" });
      }
      const productId = String(item.productId || "");
      const quantity = Number(item.quantity);
      if (!mongoose.Types.ObjectId.isValid(productId) || !Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ message: "Invalid order item" });
      }
      requestedItems.set(productId, (requestedItems.get(productId) || 0) + quantity);
    }

    const products = await Product.find({ _id: { $in: [...requestedItems.keys()] } });
    if (products.length !== requestedItems.size) {
      return res.status(400).json({ message: "One or more products are no longer available" });
    }
    const invalidPriceProduct = products.find((product) => product.price < 1);
    if (invalidPriceProduct) {
      return res.status(400).json({ message: `${invalidPriceProduct.name} cannot be ordered at this price` });
    }

    const orderItems = [];
    for (const product of products) {
      const quantity = requestedItems.get(String(product._id));
      const reservation = await Product.updateOne(
        { _id: product._id, stock: { $gte: quantity } },
        { $inc: { stock: -quantity } }
      );
      if (reservation.modifiedCount !== 1) {
        await restoreStock(reservedItems);
        return res.status(409).json({ message: `${product.name} does not have enough stock` });
      }
      reservedItems.set(String(product._id), quantity);
      orderItems.push({ productId: product._id, quantity, price: product.price });
    }

    const totalAmount = orderItems.reduce((total, item) => total + item.price * item.quantity, 0);
    const normalizedAddress = {
      fullName: address.fullName.trim(),
      street: address.street.trim(),
      city: address.city.trim(),
      postalCode: Number(address.postalCode),
      state: address.state.trim(),
      country: address.country.trim(),
    };

    const order = new Order({
      user: req.user._id,
      items: orderItems,
      totalAmount,
      address: normalizedAddress,
      paymentMethod,
    });

    await order.save();

    reservedItems.clear();
    const message = `Dear ${req.user.name},

Thank you for shopping with ApnaKart!

Your order has been placed successfully.

Order ID: ${order._id}
Total Amount: ₹${totalAmount}
    Shipping Address: ${normalizedAddress.fullName}, ${normalizedAddress.street}, ${normalizedAddress.city}, ${normalizedAddress.state} ${normalizedAddress.postalCode}, ${normalizedAddress.country}

Thank you for choosing ApnaKart!

Best Regards,
Team ApnaKart`;

    try {
      await sendEmail(
        req.user.email,
        "ApnaKart - Order Confirmation",
        message
      );
    } catch (emailError) {
      console.error("Order confirmation email failed:", emailError);
    }

    return res.status(201).json({
      message: "Order created successfully",
      order,
    });
  } catch (err) {
    if (reservedItems.size) {
      await restoreStock(reservedItems);
    }
    console.error("Create Order Error:", err);
    return res.status(500).json({
      message: "Server error",
    });
  }
};

// Get logged-in user's orders
const myOrder = async (req, res) => {
  try {
    const orders = await Order.find({
      user: req.user._id,
    }).populate("items.productId", "name price");

    return res.status(200).json(orders);
  } catch (err) {
    console.error("My Orders Error:", err);
    return res.status(500).json({
      message: "Server error",
    });
  }
};

// Admin: Get all orders
const getOrders = async (req, res) => {
  try {
    const orders = await Order.find({})
      .populate("user", "id name");

    return res.status(200).json(orders);
  } catch (err) {
    console.error("Get Orders Error:", err);
    return res.status(500).json({
      message: "Server error",
    });
  }
};

// Admin: Update order status
const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        message: "Status is required",
      });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    order.status = status;
    await order.save();

    return res.status(200).json({
      message: "Order status updated successfully",
      order,
    });
 
} catch (err) {
  console.error("Update Order Status Error:", err);

  return res.status(500).json({
    message: "Error updating order status",
    error: err.message
  });
}

};

const cancelOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.status === "Cancelled") {
      return res.status(409).json({ message: "This order is already cancelled" });
    }
    if (order.paymentStatus === "Paid") {
      return res.status(409).json({
        message: "This order has been paid. Process its refund before cancelling it.",
        code: "REFUND_REQUIRED",
      });
    }
    if (!["Pending", "Processing"].includes(order.status)) {
      return res.status(409).json({ message: "Only pending or processing orders can be cancelled" });
    }

    const cancelledOrder = await Order.findOneAndUpdate(
      {
        _id: order._id,
        status: order.status,
        paymentStatus: { $ne: "Paid" },
      },
      { $set: { status: "Cancelled" } },
      { new: true },
    );
    if (!cancelledOrder) {
      return res.status(409).json({ message: "The order changed before it could be cancelled. Refresh and try again" });
    }

    const results = await Promise.allSettled(cancelledOrder.items.map((item) => Product.updateOne(
      { _id: item.productId },
      { $inc: { stock: item.quantity } },
    )));
    const failedRestores = results.filter((result) => result.status === "rejected");
    if (failedRestores.length) {
      console.error("Cancelled order stock restoration failed:", failedRestores.map((result) => result.reason));
      return res.status(500).json({
        message: "The order was cancelled, but inventory could not be fully restored. Reconcile stock before accepting new orders.",
        order: cancelledOrder,
      });
    }

    return res.status(200).json({ message: "Order cancelled and stock restored", order: cancelledOrder });
  } catch (error) {
    console.error("Order cancellation failed:", error);
    return res.status(500).json({ message: "Order could not be cancelled" });
  }
};

module.exports = {
  createOrder,
  myOrder,
  getOrders,
  updateOrderStatus,
  cancelOrder,
};
