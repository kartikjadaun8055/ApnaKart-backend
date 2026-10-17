const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../model/User');
const sendEmail = require('../utils/senEmail');

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_DELAY_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';

const hashOtp = (email, otp) => crypto
  .createHmac('sha256', process.env.JWT_SECRET)
  .update(`${email}:${otp}`)
  .digest('hex');

const createAuthResponse = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  token: jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' }),
});

const sendVerificationCode = async (user) => {
  const otp = crypto.randomInt(100000, 1000000).toString();
  const now = new Date();
  user.emailVerificationPending = true;
  user.emailVerificationOtpHash = hashOtp(user.email, otp);
  user.emailVerificationOtpExpiresAt = new Date(now.getTime() + OTP_TTL_MS);
  user.emailVerificationOtpSentAt = now;
  user.emailVerificationOtpAttempts = 0;
  await user.save();

  try {
    await sendEmail(
      user.email,
      'ApnaKart email verification code',
      `Your ApnaKart verification code is ${otp}. It expires in 10 minutes. If you did not request this, ignore this email.`,
    );
  } catch (error) {
    user.emailVerificationOtpHash = undefined;
    user.emailVerificationOtpExpiresAt = undefined;
    user.emailVerificationOtpSentAt = undefined;
    await user.save();
    throw error;
  }
};

const registerUser = async (req, res) => {
  const { name, password } = req.body;
  const email = normalizeEmail(req.body.email);
  if (typeof name !== 'string' || !name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ message: 'Enter your name, a valid email, and a password with at least 8 characters.' });
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      if (existingUser.emailVerificationPending) {
        const elapsed = Date.now() - new Date(existingUser.emailVerificationOtpSentAt || 0).getTime();
        if (elapsed < OTP_RESEND_DELAY_MS) {
          const retryAfterSeconds = Math.ceil((OTP_RESEND_DELAY_MS - elapsed) / 1000);
          return res.status(409).json({
            message: `This account is awaiting email verification. Enter the code already sent, or request another in ${retryAfterSeconds} seconds.`,
            code: 'EMAIL_NOT_VERIFIED',
            email,
            retryAfterSeconds,
          });
        }

        try {
          await sendVerificationCode(existingUser);
        } catch (error) {
          console.error('Verification email resend failed:', error);
          return res.status(503).json({
            message: 'This account is awaiting email verification, but a new code could not be sent.',
            code: 'OTP_DELIVERY_FAILED',
            email,
          });
        }

        return res.status(200).json({
          message: 'This account is awaiting verification. A new code was sent to your email.',
          email,
          retryAfterSeconds: OTP_RESEND_DELAY_MS / 1000,
        });
      }
      return res.status(409).json({ message: 'An account already exists for this email.' });
    }

    const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(10));
    const user = await User.create({
      name: name.trim(),
      email,
      password: passwordHash,
      verified: false,
      emailVerificationPending: true,
    });

    try {
      await sendVerificationCode(user);
    } catch (error) {
      console.error('Verification email failed:', error);
      return res.status(503).json({
        message: 'Your account is pending verification, but the code could not be sent. Please request another code.',
        code: 'OTP_DELIVERY_FAILED',
        email,
      });
    }

    return res.status(201).json({
      message: 'A verification code was sent to your email address.',
      email,
      retryAfterSeconds: OTP_RESEND_DELAY_MS / 1000,
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ message: 'Registration could not be completed.' });
  }
};

const verifyEmail = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = typeof req.body.otp === 'string' ? req.body.otp.trim() : '';
  if (!email || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ message: 'Enter the six-digit code sent to your email.' });
  }

  try {
    const user = await User.findOne({ email, emailVerificationPending: true }).select('+emailVerificationOtpHash');
    if (!user || !user.emailVerificationOtpHash) {
      return res.status(400).json({ message: 'No pending verification was found for this email.' });
    }
    if (!user.emailVerificationOtpExpiresAt || user.emailVerificationOtpExpiresAt <= new Date()) {
      return res.status(400).json({ message: 'That code has expired. Request a new code.', code: 'OTP_EXPIRED' });
    }
    if (user.emailVerificationOtpAttempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many incorrect attempts. Request a new code.', code: 'OTP_ATTEMPTS_EXCEEDED' });
    }

    const suppliedHash = Buffer.from(hashOtp(email, otp), 'hex');
    const storedHash = Buffer.from(user.emailVerificationOtpHash, 'hex');
    const isValid = suppliedHash.length === storedHash.length && crypto.timingSafeEqual(suppliedHash, storedHash);
    if (!isValid) {
      user.emailVerificationOtpAttempts += 1;
      await user.save();
      return res.status(400).json({ message: 'That code is not correct.', code: 'OTP_INVALID' });
    }

    user.verified = true;
    user.emailVerificationPending = false;
    user.emailVerificationOtpHash = undefined;
    user.emailVerificationOtpExpiresAt = undefined;
    user.emailVerificationOtpSentAt = undefined;
    user.emailVerificationOtpAttempts = 0;
    await user.save();
    return res.status(200).json(createAuthResponse(user));
  } catch (error) {
    console.error('Email verification error:', error);
    return res.status(500).json({ message: 'Email verification failed. Please try again.' });
  }
};

const resendVerificationCode = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) return res.status(400).json({ message: 'Enter a valid email address.' });

  try {
    const user = await User.findOne({ email, emailVerificationPending: true });
    if (!user) return res.status(404).json({ message: 'No account is awaiting verification for this email.' });

    const elapsed = Date.now() - new Date(user.emailVerificationOtpSentAt || 0).getTime();
    if (elapsed < OTP_RESEND_DELAY_MS) {
      const retryAfterSeconds = Math.ceil((OTP_RESEND_DELAY_MS - elapsed) / 1000);
      return res.status(429).json({
        message: `Please wait ${retryAfterSeconds} seconds before requesting another code.`,
        retryAfterSeconds,
      });
    }

    await sendVerificationCode(user);
    return res.status(200).json({
      message: 'A new verification code was sent.',
      retryAfterSeconds: OTP_RESEND_DELAY_MS / 1000,
    });
  } catch (error) {
    console.error('Verification code resend failed:', error);
    return res.status(503).json({ message: 'The verification code could not be sent. Please try again later.' });
  }
};

module.exports = { registerUser, verifyEmail, resendVerificationCode };
