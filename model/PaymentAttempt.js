const mongoose = require('mongoose');

const paymentAttemptSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 1 },
  }],
  address: {
    fullName: { type: String, required: true },
    street: { type: String, required: true },
    city: { type: String, required: true },
    postalCode: { type: Number, required: true },
    state: { type: String, required: true },
    country: { type: String, required: true },
  },
  totalAmount: { type: Number, required: true, min: 1 },
  paymentMethod: { type: String, enum: ['UPI', 'Card'], required: true },
  razorpayOrderId: { type: String, required: true, unique: true },
  razorpayPaymentId: { type: String, default: null },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  status: { type: String, enum: ['Pending', 'Verifying', 'Paid', 'Cancelled', 'Expired'], default: 'Pending' },
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true });

paymentAttemptSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model('PaymentAttempt', paymentAttemptSchema);
