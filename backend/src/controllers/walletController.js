const { validationResult } = require('express-validator');
const payos = require('../config/payos');
const walletService = require('../services/walletService');
const WalletTransaction = require('../models/WalletTransaction');
const notifTriggers = require('../services/notificationTriggers');

/**
 * @desc    Get wallet info (balance, totals)
 * @route   GET /api/wallet
 * @access  Private (Customer)
 */
const getWallet = async (req, res, next) => {
  try {
    const walletInfo = await walletService.getBalance(req.user._id);

    res.status(200).json({
      success: true,
      data: walletInfo,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create top-up via payOS QR
 * @route   POST /api/wallet/top-up
 * @access  Private (Customer)
 */
const createTopUp = async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { amount } = req.body;
    const userId = req.user._id;
    const clientUrl = String(process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');

    // Generate unique order code (timestamp-based + random)
    const orderCode = Number(
      `${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100)
        .toString()
        .padStart(2, '0')}`
    );

    // Create payOS payment link using v2 SDK
    const paymentData = {
      orderCode,
      amount: parseInt(amount),
      description: `VALO NapVi`,
      returnUrl:
        process.env.PAYOS_RETURN_URL ||
        `${clientUrl}/customer/wallet?orderCode=${orderCode}`,
      cancelUrl:
        process.env.PAYOS_CANCEL_URL ||
        `${clientUrl}/customer/wallet?orderCode=${orderCode}&cancel=true`,
      items: [
        {
          name: 'VALO wallet top-up',
          quantity: 1,
          price: parseInt(amount),
        },
      ],
    };

    const paymentLink = await payos.paymentRequests.create(paymentData);

    // Save pending transaction
    const transaction = await walletService.createPendingTopUp(
      userId,
      parseInt(amount),
      orderCode,
      paymentLink.paymentLinkId,
      paymentLink.checkoutUrl,
      `VALO wallet top-up - ${parseInt(amount).toLocaleString('vi-VN')} VND`
    );

    res.status(201).json({
      success: true,
      message: 'Payment link created successfully',
      data: {
        transactionId: transaction._id,
        orderCode,
        amount: parseInt(amount),
        checkoutUrl: paymentLink.checkoutUrl,
        qrCode: paymentLink.qrCode,
        paymentLinkId: paymentLink.paymentLinkId,
      },
    });
  } catch (error) {
    const providerCode = String(error?.response?.data?.code ?? error?.body?.code ?? error?.code ?? '');
    const providerMessage = String(error?.desc ?? error?.message ?? '');
    if (providerCode === '215' || /code\s*:\s*215|kh[oô]ng c[oó] g[oó]i n[aà]o [đd]ang ho[aạ]t [đd]ộng/i.test(providerMessage)) {
      error.statusCode = 503;
      error.code = 'PAYOS_CHANNEL_UNAVAILABLE';
      error.message = 'PayOS could not create a QR code because this merchant has no active payment channel. Activate the payment channel in the PayOS dashboard, then try again.';
    }
    next(error);
  }
};

/**
 * @desc    Check top-up transaction status
 * @route   GET /api/wallet/top-up/:orderCode/status
 * @access  Private (Customer)
 */
const getTopUpStatus = async (req, res, next) => {
  try {
    const { orderCode } = req.params;

    // Find the transaction in our DB
    const transaction = await WalletTransaction.findOne({
      payosOrderCode: parseInt(orderCode),
      userId: req.user._id,
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    const { cancel } = req.query;

    // Explicitly cancel if requested by frontend
    if (cancel === 'true' && transaction.status === 'PENDING') {
      const cancelledTransaction = await walletService.cancelPendingTopUp(parseInt(orderCode));
      try {
        await payos.paymentRequests.cancel(parseInt(orderCode));
      } catch (err) {
        // Ignore errors if already cancelled on payOS
      }
      return res.json({
        success: true,
        data: {
          transactionId: cancelledTransaction?._id || transaction._id,
          orderCode: transaction.payosOrderCode,
          amount: transaction.amount,
          status: cancelledTransaction?.status || 'CANCELLED',
          createdAt: transaction.createdAt,
        }
      });
    }

    // If still pending, check with payOS
    let payosStatus = null;
    let currentTransaction = transaction;
    if (transaction.status === 'PENDING') {
      try {
        const payosInfo = await payos.paymentRequests.get(parseInt(orderCode));
        payosStatus = payosInfo.status;

        // If payOS says PAID but we haven't processed yet, process it
        if (payosInfo.status === 'PAID' && transaction.status === 'PENDING') {
          const result = await walletService.completePendingTopUp(
            parseInt(orderCode),
            payosInfo.transactions?.[0]?.reference || null
          );
          currentTransaction = result.transaction;

          // Fire-and-forget: notify top-up success (in case webhook didn't fire)
          if (!result.alreadyProcessed && currentTransaction.userId) {
            notifTriggers.notifyTopUpSuccess(
              req.app, currentTransaction.userId, currentTransaction.amount, result.newBalance
            ).catch(err => console.error('Failed to send top-up notification:', err));
          }
        } else if (payosInfo.status === 'CANCELLED') {
          currentTransaction = await walletService.cancelPendingTopUp(parseInt(orderCode)) || transaction;
        }
      } catch (payosError) {
        console.error('Error checking payOS status:', payosError.message);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        transactionId: currentTransaction._id,
        orderCode: currentTransaction.payosOrderCode,
        amount: currentTransaction.amount,
        status: currentTransaction.status,
        payosStatus,
        createdAt: currentTransaction.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    payOS Webhook - receive payment confirmation
 * @route   POST /api/wallet/webhook
 * @access  Public (verified by payOS signature)
 */
const handleWebhook = async (req, res, next) => {
  try {
    // Verify webhook signature using payOS SDK v2
    let webhookData;
    try {
      webhookData = await payos.webhooks.verify(req.body);
    } catch (verifyError) {
      console.error('❌ Webhook signature verification failed:', verifyError.message);
      return res.status(400).json({ message: 'Invalid signature' });
    }

    // payOS test webhook - ignore
    if (['Ma giao dich thu nghiem', 'VQRIO123'].includes(webhookData.description)) {
      return res.status(200).json({ message: 'OK - Test webhook' });
    }

    const { orderCode, amount, reference, description, code, desc } = webhookData;

    console.log(`📥 Webhook received - orderCode: ${orderCode}, amount: ${amount}, status: ${code}`);

    // Only process successful payments (code === "00")
    if (code === '00') {
      try {
        const result = await walletService.completePendingTopUp(orderCode, reference);

        if (result.alreadyProcessed) {
          console.log(`ℹ️ OrderCode ${orderCode} already processed (idempotent)`);
        } else {
          console.log(`✅ Top-up completed - orderCode: ${orderCode}, newBalance: ${result.newBalance}`);

          // Fire-and-forget: notify user of successful top-up
          if (result.transaction && result.transaction.userId) {
            notifTriggers.notifyTopUpSuccess(req.app, result.transaction.userId, amount, result.newBalance);
          }
        }
      } catch (processError) {
        console.error(`❌ Error processing webhook for orderCode ${orderCode}:`, processError.message);
        // Still return 200 to prevent payOS from retrying
      }
    } else {
      // Payment failed or cancelled
      await walletService.cancelPendingTopUp(orderCode);
      console.log(`⚠️ Payment not successful for orderCode ${orderCode}: ${desc}`);
    }

    // Always return 200 to acknowledge webhook
    res.status(200).json({ message: 'OK' });
  } catch (error) {
    console.error('❌ Webhook handler error:', error.message);
    // Still return 200 to prevent infinite retries
    res.status(200).json({ message: 'OK' });
  }
};

/**
 * @desc    Get wallet transaction history
 * @route   GET /api/wallet/transactions
 * @access  Private (Customer)
 */
const getTransactions = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { page, limit, type, status } = req.query;

    const result = await walletService.getTransactionHistory(req.user._id, {
      page,
      limit,
      type,
      status,
    });

    res.status(200).json({
      success: true,
      data: result.transactions,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getWallet,
  createTopUp,
  getTopUpStatus,
  handleWebhook,
  getTransactions,
};
