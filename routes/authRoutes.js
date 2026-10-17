const express = require("express");
const router = express.Router();
const { loginUser, getUsers } = require("../controller/authController");
const { registerUser, verifyEmail, resendVerificationCode } = require("../controller/emailVerificationController");
const { requestPasswordReset, resetPassword } = require("../controller/passwordResetController");
const{protect} = require('../middleware/authMiddleware');
const  {admin} = require('../middleware/adminMiddleware');

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerificationCode);
router.post("/forgot-password", requestPasswordReset);
router.post("/reset-password", resetPassword);
router.get("/users", protect, admin,  getUsers);

module.exports = router;