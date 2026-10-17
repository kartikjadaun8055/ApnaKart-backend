const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
    user:{type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
    items:[{
        productId:{type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true},
        quantity:{ type: Number, required: true, min: 1},
        price:{type: Number, required: true, min: 1},
    }],

    totalAmount :{type: Number, required: true},
    paymentId: { type: String, unique: true, sparse: true },
    paymentStatus: {
        type: String,
        enum: ["Pending", "Paid", "Failed"],
        default: "Pending"
    },

    address:{
        fullName:{type: String, required: true},
        street:{type: String, required: true},
        city:{type: String, required: true},
        postalCode:{type: Number, required: true},
        state:{type: String, required: true},
        country:{type: String, required: true},

    },
    paymentMethod:{type: String},
    status: {
  type: String,
  enum: ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"],
  default: "Pending"
}



},{timestamps: true});


module.exports = mongoose.model("Order", orderSchema);