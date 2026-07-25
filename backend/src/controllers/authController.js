const { validationResult } = require('express-validator');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const UserDetail = require('../models/UserDetail');
const UserToken = require('../models/UserToken');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require('../utils/tokenUtils');
const { generateOTP, sendOTPEmail, sendResetPasswordEmail } = require('../utils/emailUtils');
const { buildOtpAutofillHint, getOtpAutofillConfig } = require('../utils/otpAutofillUtils');
const notifTriggers = require('../services/notificationTriggers');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Public
 */
const register = async (req, res, next) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map((err) => ({
          field: err.path,
          message: err.msg,
        })),
      });
    }

    const { username, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      const field = existingUser.email === email ? 'Email' : 'Username';
      return res.status(409).json({
        success: false,
        message: `${field} already exists.`,
      });
    }

    // Create user
    const user = await User.create({
      username,
      email,
      password,
      role: 'customer', // Default role for registration
    });

    // Create empty user detail profile
    await UserDetail.create({
      userId: user._id,
    });

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Save refresh token to DB
    const refreshExpiry = new Date();
    refreshExpiry.setDate(refreshExpiry.getDate() + 7); // 7 days

    await UserToken.create({
      userId: user._id,
      type: 'refresh',
      tokenValue: refreshToken,
      expiresAt: refreshExpiry,
    });

    // Fire-and-forget: send welcome notification
    notifTriggers.notifyRegistrationSuccess(req.app, user._id);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Login user
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = async (req, res, next) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map((err) => ({
          field: err.path,
          message: err.msg,
        })),
      });
    }

    const { email, password } = req.body;

    // Find user and include password field
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    // Check if account is active
    if (!user.status) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact admin.',
      });
    }

    // Compare password
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Remove old refresh tokens for this user
    await UserToken.deleteMany({ userId: user._id, type: 'refresh' });

    // Save new refresh token
    const refreshExpiry = new Date();
    refreshExpiry.setDate(refreshExpiry.getDate() + 7);

    await UserToken.create({
      userId: user._id,
      type: 'refresh',
      tokenValue: refreshToken,
      expiresAt: refreshExpiry,
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          membership: user.membership,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Refresh access token
 * @route   POST /api/auth/refresh-token
 * @access  Public (requires valid refresh token)
 */
const refreshAccessToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required.',
      });
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token.',
      });
    }

    // Check if refresh token exists in DB
    const storedToken = await UserToken.findOne({
      userId: decoded.id,
      type: 'refresh',
      tokenValue: refreshToken,
    });

    if (!storedToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token not found. Please login again.',
      });
    }

    // Get user
    const user = await User.findById(decoded.id);

    if (!user || !user.status) {
      return res.status(401).json({
        success: false,
        message: 'User not found or account deactivated.',
      });
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user);

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Logout user (invalidate refresh token)
 * @route   POST /api/auth/logout
 * @access  Private
 */
const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      // Delete specific refresh token
      await UserToken.findOneAndDelete({
        userId: req.user._id,
        type: 'refresh',
        tokenValue: refreshToken,
      });
    } else {
      // Delete all refresh tokens for this user
      await UserToken.deleteMany({ userId: req.user._id, type: 'refresh' });
    }

    res.status(200).json({
      success: true,
      message: 'Logout successful',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get current logged-in user
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    const userDetail = await UserDetail.findOne({ userId: req.user._id });

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
          membership: user.membership,
        },
        profile: userDetail || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

const updatePushToken = async (req, res, next) => {
  try {
    const { expoPushToken } = req.body;
    if (!expoPushToken || typeof expoPushToken !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Expo push token is required.',
      });
    }

    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { expoPushTokens: expoPushToken },
    });

    res.status(200).json({
      success: true,
      message: 'Push token updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Login / Register with Google OAuth
 * @route   POST /api/auth/google
 * @access  Public
 */
const googleLogin = async (req, res, next) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'Google ID token is required.',
      });
    }

    // Verify the Google ID token
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token.',
      });
    }

    const { sub: googleId, email, name, picture } = payload;

    // Find existing user by googleId or email
    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    if (user) {
      // Link googleId if not already linked
      if (!user.googleId) {
        user.googleId = googleId;
        user.isEmailVerified = true;
        await user.save();
      }

      if (!user.status) {
        return res.status(403).json({
          success: false,
          message: 'Your account has been deactivated. Please contact admin.',
        });
      }
    } else {
      // Create new user from Google info
      const baseUsername = (name || email.split('@')[0])
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .slice(0, 25);

      // Ensure username is unique by appending random suffix if needed
      let username = baseUsername;
      const existing = await User.findOne({ username });
      if (existing) {
        username = `${baseUsername}_${Math.floor(1000 + Math.random() * 9000)}`;
      }

      user = await User.create({
        username,
        email,
        googleId,
        isEmailVerified: true,
        role: 'customer',
      });

      const nameParts = (name || '').trim().split(' ');
      const firstName = nameParts.length > 0 ? nameParts[0] : '';
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

      // Create empty user detail profile
      await UserDetail.create({
        userId: user._id,
        firstName,
        lastName,
        avatar: picture || '',
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await UserToken.deleteMany({ userId: user._id, type: 'refresh' });

    const refreshExpiry = new Date();
    refreshExpiry.setDate(refreshExpiry.getDate() + 7);

    await UserToken.create({
      userId: user._id,
      type: 'refresh',
      tokenValue: refreshToken,
      expiresAt: refreshExpiry,
    });

    res.status(200).json({
      success: true,
      message: 'Google login successful',
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          membership: user.membership,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Send OTP to email for account verification
 * @route   POST /api/auth/send-otp
 * @access  Public
 */
const sendOTP = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map((err) => ({ field: err.path, message: err.msg })),
      });
    }

    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email.',
      });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified.',
      });
    }

    // Remove any existing OTP for this user
    await UserToken.deleteMany({ userId: user._id, type: 'email_verification' });

    // Generate OTP and set 10-minute expiry
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    await UserToken.create({
      userId: user._id,
      type: 'email_verification',
      tokenValue: otp,
      expiresAt: otpExpiry,
    });

    await sendOTPEmail(email, otp);

    res.status(200).json({
      success: true,
      message: 'OTP sent to your email. It will expire in 10 minutes.',
      data: {
        expiresIn: 600,
        autofillHint: buildOtpAutofillHint(),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get OTP autofill metadata for web clients
 * @route   GET /api/auth/otp-config
 * @access  Public
 */
const getOTPConfig = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      message: 'OTP autofill config retrieved successfully.',
      data: getOtpAutofillConfig(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify OTP to confirm email
 * @route   POST /api/auth/verify-otp
 * @access  Public
 */
const verifyOTP = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map((err) => ({ field: err.path, message: err.msg })),
      });
    }

    const { email, otp } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email.',
      });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified.',
      });
    }

    // Find the OTP record
    const otpRecord = await UserToken.findOne({
      userId: user._id,
      type: 'email_verification',
      tokenValue: otp,
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP.',
      });
    }

    // Check expiry (TTL index handles cleanup but we double-check)
    if (otpRecord.expiresAt < new Date()) {
      await otpRecord.deleteOne();
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.',
      });
    }

    // Mark email as verified and delete OTP
    user.isEmailVerified = true;
    await user.save();
    await otpRecord.deleteOne();

    // Fire-and-forget: send verification notification
    notifTriggers.notifyEmailVerified(req.app, user._id);

    res.status(200).json({
      success: true,
      message: 'Email verified successfully.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Send OTP for password reset
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
const forgotPassword = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map((err) => ({ field: err.path, message: err.msg })),
      });
    }

    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Email does not exist.',
      });
    }

    // Remove any existing reset OTPs
    await UserToken.deleteMany({ userId: user._id, type: 'reset_password' });

    const otp = generateOTP();
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await UserToken.create({
      userId: user._id,
      type: 'reset_password',
      tokenValue: otp,
      expiresAt: expiry,
    });

    await sendResetPasswordEmail(email, otp);

    res.status(200).json({
      success: true,
      message: 'OTP sent to your email. It will expire in 15 minutes.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify OTP for password reset
 * @route   POST /api/auth/verify-reset-otp
 * @access  Public
 */
const verifyResetPasswordOTP = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map((err) => ({ field: err.path, message: err.msg })),
      });
    }

    const { email, otp } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid request.' });
    }

    const otpRecord = await UserToken.findOne({
      userId: user._id,
      type: 'reset_password',
      tokenValue: otp,
    });

    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      if (otpRecord) await otpRecord.deleteOne();
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Reset password using OTP
 * @route   POST /api/auth/reset-password
 * @access  Public
 */
const resetPassword = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map((err) => ({ field: err.path, message: err.msg })),
      });
    }

    const { email, otp, newPassword } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid request.' });
    }

    const otpRecord = await UserToken.findOne({
      userId: user._id,
      type: 'reset_password',
      tokenValue: otp,
    });

    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      if (otpRecord) await otpRecord.deleteOne();
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }

    // Update password (pre-save hook will hash it)
    user.password = newPassword;
    await user.save();

    // Clean up OTP and all refresh tokens (force re-login)
    await otpRecord.deleteOne();
    await UserToken.deleteMany({ userId: user._id, type: 'refresh' });

    // Fire-and-forget: send password change notification
    notifTriggers.notifyPasswordChanged(req.app, user._id);

    res.status(200).json({
      success: true,
      message: 'Password reset successfully. Please login with your new password.',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  refreshAccessToken,
  logout,
  getMe,
  updatePushToken,
  googleLogin,
  sendOTP,
  getOTPConfig,
  verifyOTP,
  forgotPassword,
  verifyResetPasswordOTP,
  resetPassword,
};
