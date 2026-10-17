
const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, ".env"),
});

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const Product = require("./model/Product");
const User = require("./model/User");

const products = [
  {
    name: "Everyday Cotton T-Shirt",
    description: "Soft, breathable cotton T-shirt for everyday wear.",
    price: 499,
    category: "Clothing",
    stock: 40,
  },
  {
    name: "Classic Denim Jeans",
    description: "Comfort-fit denim jeans with a classic five-pocket design.",
    price: 1499,
    category: "Clothing",
    stock: 25,
  },
  {
    name: "Wireless Bluetooth Headphones",
    description: "Over-ear wireless headphones with a built-in microphone.",
    price: 2299,
    category: "Electronics",
    stock: 18,
  },
  {
    name: "Insulated Steel Water Bottle",
    description: "Reusable stainless steel bottle for hot and cold drinks.",
    price: 799,
    category: "Home & Kitchen",
    stock: 32,
  },
  {
    name: "Everyday Backpack",
    description: "Lightweight backpack with a padded laptop compartment.",
    price: 1899,
    category: "Accessories",
    stock: 14,
  },
  {
    name: "Ceramic Coffee Mug Set",
    description: "Set of two durable ceramic mugs for coffee or tea.",
    price: 599,
    category: "Home & Kitchen",
    stock: 20,
  },
];

const users = [
  {
    name: "ApnaKart Admin",
    email: "admin@apnakart.com",
    password: "Admin@123",
    role: "admin",
  },
  {
    name: "ApnaKart User",
    email: "user@apnakart.com",
    password: "User@123",
    role: "user",
  },
];

const seedUsers = async () => {
  for (const userData of users) {
    const existingUser = await User.findOne({
      email: userData.email,
    });

    if (existingUser) {
      // Do not overwrite an existing account.
      console.log(`User already exists: ${userData.email}`);
      continue;
    }

    const hashedPassword = await bcrypt.hash(
      userData.password,
      10
    );

    await User.create({
      ...userData,
      password: hashedPassword,
    });

    console.log(`User created: ${userData.email}`);
  }
};

const seedProducts = async () => {
  const result = await Product.bulkWrite(
    products.map((product) => ({
      updateOne: {
        filter: { name: product.name },
        update: { $setOnInsert: product },
        upsert: true,
      },
    }))
  );

  console.log(
    `Products seeded: ${result.upsertedCount} new product(s) added.`
  );
};

const seedDatabase = async () => {
  try {
    if (!process.env.MONGO_URL) {
      throw new Error("MONGO_URL is not set in backend/.env");
    }

    await mongoose.connect(process.env.MONGO_URL);
    console.log("MongoDB connected successfully");

    await seedUsers();
    await seedProducts();

    console.log("ApnaKart database seeding completed!");
  } catch (error) {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

seedDatabase();
