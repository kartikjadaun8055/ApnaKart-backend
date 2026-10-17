
require("dotenv").config();

const express = require("express");
const cors = require("cors");

const connectDB = require("./config/db");
const userRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const orderRoutes = require("./routes/orderRoutes");
const paymentRoutes = require("./routes/paymentRoutes");

// Cloudinary configuration
require("./config/cloudinary");

const app = express();

// Middleware
app.use(cors(
  {origin: [
    "http://localhost:5173",
    "https://apankart-8b338.web.app",
    "https://apankart-8b338.firebaseapp.com"
  ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  }
));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database
connectDB();

// Health check
app.get("/health", (req, res) => {
  res.send("ApnaKart Backend is running!");
});

// API routes
app.use("/api/auth", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/analytics", analyticsRoutes);

// Start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
