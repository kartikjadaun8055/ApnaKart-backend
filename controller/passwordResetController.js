const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../model/User');
const sendEmail = require('../utils/senEmail');

const RESET_TTL_MS = 20 * 60 * 1000;
const RESET_RESEND_DELAY_MS = 60 * 1000;
const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const genericResponse = { message: 'If an eligible account exists for that email, a password reset link will be sent.' };

const requestPasswordReset = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) return res.status(200).json(genericResponse);

  try {
    const user = await User.findOne({ email, emailVerificationPending: { $ne: true } });
    if (!user) return res.status(200).json(genericResponse);

    const elapsed = Date.now() - new Date(user.passwordResetSentAt || 0).getTime();
    if (elapsed < RESET_RESEND_DELAY_MS) return res.status(200).json(genericResponse);

    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetTokenHash = hashToken(token);
    user.passwordResetExpiresAt = new Date(Date.now() + RESET_TTL_MS);
    user.passwordResetSentAt = new Date();
    await user.save();

    const configuredAppUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL;
    const requestOrigin = req.get('origin') || '';
    const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin) ? requestOrigin : '';
    const appUrl = configuredAppUrl || localOrigin || 'http://localhost:5173';
    const resetUrl = new URL('/reset-password', appUrl);
    resetUrl.searchParams.set('token', token);

    try {
      await sendEmail(
        user.email,
        'Reset your ApnaKart password',
        `Use this link to reset your password. It expires in 20 minutes and can only be used once:\n\n${resetUrl.toString()}\n\nIf you did not request this, ignore this email.`,
      );
    } catch (error) {
      user.passwordResetTokenHash = undefined;
      user.passwordResetExpiresAt = undefined;
      await user.save();
      console.error('Password reset email failed:', error);
    }

    return res.status(200).json(genericResponse);
  } catch (error) {
    console.error('Password reset request failed:', error);
    return res.status(200).json(genericResponse);
  }
};

const resetPassword = async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
  const password = req.body.password;
  if (!/^[a-f0-9]{64}$/i.test(token) || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ message: 'Use a valid reset link and a password with at least 8 characters.' });
  }

  try {
    const user = await User.findOne({
      passwordResetTokenHash: hashToken(token),
      passwordResetExpiresAt: { $gt: new Date() },
    }).select('+passwordResetTokenHash');

    if (!user) return res.status(400).json({ message: 'This reset link is invalid or has expired. Request a new one.' });

    user.password = await bcrypt.hash(password, await bcrypt.genSalt(10));
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpiresAt = undefined;
    user.passwordResetSentAt = undefined;
    await user.save();

    return res.status(200).json({ message: 'Password reset successfully. Sign in with your new password.' });
  } catch (error) {
    console.error('Password reset failed:', error);
    return res.status(500).json({ message: 'Password could not be reset. Please try again.' });
  }
};

module.exports = { requestPasswordReset, resetPassword };
