const Razorpay = require('razorpay');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Product = require('../model/Product');
const Order = require('../model/Order');
const PaymentAttempt = require('../model/PaymentAttempt');
const sendEmail = require('../utils/senEmail');

const PAYMENT_TTL_MS = 15 * 60 * 1000;
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const getGateway = () => new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const restoreInventory = async (items) => {
    const failedItems = [];
    for (const item of items) {
        try {
            await Product.updateOne({ _id: item.productId }, { $inc: { stock: item.quantity } });
        } catch (error) {
            console.error('Payment stock restoration failed:', error);
            failedItems.push(item);
        }
    }
    return failedItems;
};

const cleanupExpiredAttempts = async () => {
    const staleVerificationCutoff = new Date(Date.now() - 2 * 60 * 1000);
    await PaymentAttempt.updateMany(
        { status: 'Verifying', updatedAt: { $lte: staleVerificationCutoff }, expiresAt: { $gt: new Date() } },
        { $set: { status: 'Pending' } },
    );

    const expired = await PaymentAttempt.find({
        status: { $in: ['Pending', 'Verifying'] },
        expiresAt: { $lte: new Date() },
    }).limit(50);

    for (const attempt of expired) {
        const claimed = await PaymentAttempt.findOneAndUpdate(
            { _id: attempt._id, status: { $in: ['Pending', 'Verifying'] } },
            { $set: { status: 'Expired' } },
            { new: true },
        );
        if (claimed) {
            const failedItems = await restoreInventory(claimed.items);
            if (failedItems.length) {
                await PaymentAttempt.updateOne(
                    { _id: claimed._id, status: 'Expired' },
                    { $set: { status: 'Pending', items: failedItems } },
                );
            }
        }
    }
};

const reserveItems = async (requestedItems) => {
    const productIds = [...requestedItems.keys()];
    if (!productIds.every((id) => mongoose.Types.ObjectId.isValid(id))) {
        const error = new Error('One or more products are invalid.');
        error.status = 400;
        throw error;
    }

    const products = await Product.find({ _id: { $in: productIds } });
    if (products.length !== productIds.length) {
        const error = new Error('One or more products are no longer available.');
        error.status = 400;
        throw error;
    }

    if (products.some((product) => Number(product.price) < 1)) {
        const error = new Error('One or more products have an invalid price.');
        error.status = 400;
        throw error;
    }

    const orderedItems = [];
    const reservedItems = [];
    try {
        for (const product of products) {
            const quantity = requestedItems.get(String(product._id));
            const result = await Product.updateOne(
                { _id: product._id, stock: { $gte: quantity } },
                { $inc: { stock: -quantity } },
            );
            if (result.modifiedCount !== 1) {
                const error = new Error(`${product.name} does not have enough stock.`);
                error.status = 409;
                throw error;
            }

            const orderItem = { productId: product._id, quantity, price: Number(product.price) };
            reservedItems.push(orderItem);
            orderedItems.push(orderItem);
        }
        return { orderedItems, reservedItems };
    } catch (error) {
        await restoreInventory(reservedItems);
        throw error;
    }
};

const createdOrder = async (req, res) => {
    let reservedItems = [];
    try {
        if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            return res.status(503).json({ message: 'Online payments are not configured.' });
        }

        const { items, address, paymentMethod } = req.body;
        if (!['UPI', 'Card'].includes(paymentMethod)) {
            return res.status(400).json({ message: 'Choose UPI or debit/credit card.' });
        }
        if (
            !Array.isArray(items) || items.length === 0 ||
            !address || typeof address !== 'object' || Array.isArray(address) ||
            !hasText(address.fullName) || !hasText(address.street) || !hasText(address.city) ||
            !hasText(address.state) || !hasText(address.country) ||
            !Number.isInteger(Number(address.postalCode)) || Number(address.postalCode) <= 0
        ) {
            return res.status(400).json({ message: 'Enter all required delivery details.' });
        }

        const requestedItems = new Map();
        for (const item of items) {
            const productId = String(item?.productId || '');
            const quantity = Number(item?.quantity);
            if (!mongoose.Types.ObjectId.isValid(productId) || !Number.isInteger(quantity) || quantity < 1) {
                return res.status(400).json({ message: 'The cart contains an invalid item.' });
            }
            requestedItems.set(productId, (requestedItems.get(productId) || 0) + quantity);
        }

        await cleanupExpiredAttempts();
        const reserved = await reserveItems(requestedItems);
        reservedItems = reserved.reservedItems;
        const totalAmount = reserved.orderedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const normalizedAddress = {
            fullName: address.fullName.trim(),
            street: address.street.trim(),
            city: address.city.trim(),
            postalCode: Number(address.postalCode),
            state: address.state.trim(),
            country: address.country.trim(),
        };

        const gatewayOrder = await getGateway().orders.create({
            amount: Math.round(totalAmount * 100),
            currency: 'INR',
            receipt: crypto.randomBytes(12).toString('hex'),
        });

        const attempt = await PaymentAttempt.create({
            user: req.user._id,
            items: reserved.orderedItems,
            address: normalizedAddress,
            totalAmount,
            paymentMethod,
            razorpayOrderId: gatewayOrder.id,
            expiresAt: new Date(Date.now() + PAYMENT_TTL_MS),
        });
        reservedItems = [];

        return res.status(201).json({
            id: gatewayOrder.id,
            amount: gatewayOrder.amount,
            currency: gatewayOrder.currency,
            keyId: process.env.RAZORPAY_KEY_ID,
            attemptId: attempt._id,
        });
    } catch (error) {
        if (reservedItems.length) await restoreInventory(reservedItems);
        console.error('Razorpay order creation failed:', error);
        return res.status(error.status || 502).json({ message: error.message || 'Online payment could not be started.' });
    }
};

const verifyPayment = async (req, res) => {
    const { razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId, razorpay_signature: signature } = req.body;
    if (![razorpayOrderId, razorpayPaymentId, signature].every((value) => typeof value === 'string' && value)) {
        return res.status(400).json({ message: 'Incomplete payment verification details.' });
    }

    let lockedAttemptId = null;
    try {
        const attempt = await PaymentAttempt.findOne({ razorpayOrderId, user: req.user._id });
        if (!attempt) return res.status(404).json({ message: 'Payment attempt was not found.' });

        if (attempt.status === 'Paid' && attempt.razorpayPaymentId === razorpayPaymentId && attempt.order) {
            const existingOrder = await Order.findById(attempt.order);
            if (existingOrder) return res.status(200).json({ message: 'Payment verified.', order: existingOrder });
        }
        if (attempt.status !== 'Pending' || attempt.expiresAt <= new Date()) {
            return res.status(409).json({ message: 'This payment attempt has expired. Start checkout again.' });
        }

        const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpayOrderId}|${razorpayPaymentId}`)
            .digest();
        const receivedSignature = Buffer.from(signature, 'hex');
        if (receivedSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(receivedSignature, expectedSignature)) {
            return res.status(400).json({ message: 'Payment signature verification failed.' });
        }

        const lockedAttempt = await PaymentAttempt.findOneAndUpdate(
            { _id: attempt._id, status: 'Pending', expiresAt: { $gt: new Date() } },
            { $set: { status: 'Verifying' } },
            { new: true },
        );
        if (!lockedAttempt) return res.status(409).json({ message: 'Payment attempt is already being processed.' });
        lockedAttemptId = lockedAttempt._id;

        let payment;
        try {
            payment = await getGateway().payments.fetch(razorpayPaymentId);
        } catch (error) {
            await PaymentAttempt.updateOne({ _id: lockedAttempt._id, status: 'Verifying' }, { $set: { status: 'Pending' } });
            console.error('Razorpay payment lookup failed:', error);
            return res.status(502).json({ message: 'Could not confirm payment with the payment provider.' });
        }

        const expectedAmount = Math.round(lockedAttempt.totalAmount * 100);
        const expectedMethod = lockedAttempt.paymentMethod === 'UPI' ? 'upi' : 'card';
        if (
            payment.order_id !== razorpayOrderId ||
            payment.amount !== expectedAmount ||
            payment.currency !== 'INR' ||
            payment.status !== 'captured' ||
            payment.method !== expectedMethod
        ) {
            await PaymentAttempt.updateOne({ _id: lockedAttempt._id, status: 'Verifying' }, { $set: { status: 'Pending' } });
            return res.status(409).json({ message: 'Payment is not captured or does not match this order.' });
        }

        let order = await Order.findOne({ paymentId: razorpayPaymentId });
        if (!order) {
            order = await Order.create({
                user: lockedAttempt.user,
                items: lockedAttempt.items,
                totalAmount: lockedAttempt.totalAmount,
                address: lockedAttempt.address,
                paymentMethod: lockedAttempt.paymentMethod,
                paymentId: razorpayPaymentId,
                paymentStatus: 'Paid',
            });
        }

        lockedAttempt.status = 'Paid';
        lockedAttempt.razorpayPaymentId = razorpayPaymentId;
        lockedAttempt.order = order._id;
        await lockedAttempt.save();

        try {
            await sendEmail(
                req.user.email,
                'ApnaKart - Order Confirmation',
                `Your payment was confirmed and your order was placed.\n\nOrder ID: ${order._id}\nTotal: ₹${order.totalAmount}`,
            );
        } catch (emailError) {
            console.error('Online order confirmation email failed:', emailError);
        }

        return res.status(200).json({ message: 'Payment verified and order created.', order });
    } catch (error) {
        if (lockedAttemptId) {
            await PaymentAttempt.updateOne(
                { _id: lockedAttemptId, status: 'Verifying' },
                { $set: { status: 'Pending' } },
            ).catch((resetError) => console.error('Payment attempt recovery failed:', resetError));
        }
        console.error('Payment verification failed:', error);
        return res.status(500).json({ message: 'Payment could not be verified. Please contact support before retrying.' });
    }
};

const cancelPayment = async (req, res) => {
    const { razorpayOrderId } = req.body;
    if (typeof razorpayOrderId !== 'string' || !razorpayOrderId) {
        return res.status(400).json({ message: 'Payment order ID is required.' });
    }

    try {
        const attempt = await PaymentAttempt.findOneAndUpdate(
            { razorpayOrderId, user: req.user._id, status: 'Pending' },
            { $set: { status: 'Cancelled' } },
            { new: true },
        );
        if (!attempt) return res.status(409).json({ message: 'Payment attempt is no longer cancellable.' });
        const failedItems = await restoreInventory(attempt.items);
        if (failedItems.length) {
            await PaymentAttempt.updateOne(
                { _id: attempt._id, status: 'Cancelled' },
                { $set: { status: 'Pending', items: failedItems, expiresAt: new Date() } },
            );
            return res.status(500).json({ message: 'Payment was cancelled, but inventory restoration failed.' });
        }
        return res.status(200).json({ message: 'Payment attempt cancelled.' });
    } catch (error) {
        console.error('Payment cancellation failed:', error);
        return res.status(500).json({ message: 'Payment attempt could not be cancelled.' });
    }
};

const expiryTimer = setInterval(() => {
    cleanupExpiredAttempts().catch((error) => console.error('Payment expiry cleanup failed:', error));
}, 60 * 1000);
expiryTimer.unref?.();

module.exports = { createdOrder, verifyPayment, cancelPayment, cleanupExpiredAttempts };