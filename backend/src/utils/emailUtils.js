const nodemailer = require('nodemailer');
const { buildWebOtpLine } = require('./otpAutofillUtils');

/**
 * Create reusable transporter using env credentials
 */
const createTransporter = (options = {}) => {
  // Gmail displays App Passwords in groups separated by spaces. SMTP expects
  // the 16-character token without formatting whitespace.
  const smtpPassword = String(process.env.EMAIL_PASS || '').replace(/\s+/g, '');
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_PORT === '465',
    auth: {
      user: process.env.EMAIL_USER,
      pass: smtpPassword,
    },
    ...options,
  });
};

/**
 * Generate a 6-digit numeric OTP
 * @returns {string} 6-digit OTP
 */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Send OTP verification email (for signup)
 */
const sendOTPEmail = async (toEmail, otp) => {
  const transporter = createTransporter();
  const webOtpLine = buildWebOtpLine(otp);

  await transporter.sendMail({
    from: `"VALO Parking" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Your Email Verification OTP Code',
    text: [
      'Email Verification',
      'Use the OTP below to verify your email address. It will expire in 10 minutes.',
      '',
      otp,
      '',
      'If you did not request this, please ignore this email.',
      webOtpLine,
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <h2 style="color: #1f2937; margin-bottom: 8px;">Email Verification</h2>
        <p style="color: #6b7280; margin-bottom: 24px;">Use the OTP below to verify your email address. It will expire in <strong>10 minutes</strong>.</p>
        <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; text-align: center; letter-spacing: 8px; font-size: 32px; font-weight: bold; color: #111827;">
          ${otp}
        </div>
        <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">If you did not request this, please ignore this email.</p>
        <p style="color: #d1d5db; font-size: 1px; line-height: 1px; margin: 0;">${webOtpLine}</p>
      </div>
    `,
  });
};

/**
 * Send OTP for password reset
 */
const sendResetPasswordEmail = async (toEmail, otp) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"VALO Parking" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Reset Your Password — VALO Parking',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <h2 style="color: #1f2937; margin-bottom: 8px;">Password Reset</h2>
        <p style="color: #6b7280; margin-bottom: 24px;">Use the OTP below to reset your password. It will expire in <strong>15 minutes</strong>.</p>
        <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; text-align: center; letter-spacing: 8px; font-size: 32px; font-weight: bold; color: #111827;">
          ${otp}
        </div>
        <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">If you did not request a password reset, please ignore this email.</p>
      </div>
    `,
  });
};

/**
 * Send Booking Confirmation Email
 */
const sendBookingConfirmationEmail = async (toEmail, bookingDetails) => {
  const transporter = createTransporter();
  const { bookingId, arrivalTime, parkingSlot, licensePlate } = bookingDetails;
  
  await transporter.sendMail({
    from: `"VALO Parking" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Booking Confirmed — VALO Parking',
    html: `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #050505; color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
        
        <!-- Header Banner -->
        <div style="background: #000000; padding: 25px; text-align: center; border-bottom: 3px solid #FFDF00;">
          <img src="https://res.cloudinary.com/dlelhpfjn/image/upload/v1780239706/valo_parking/assets/xrgz2v4wkd84qyipa9p4.png" alt="VALO PARKING" style="max-height: 50px; width: auto; margin: 0 auto; display: block;" />
        </div>
        <div style="padding: 32px;">
          <h2 style="color: #f1f5f9; margin-top: 0; margin-bottom: 16px; font-size: 20px;">Booking Confirmed! ✅</h2>
          <p style="color: #cbd5e1; line-height: 1.6; margin-bottom: 24px;">Thank you for choosing ValoParking. Your parking spot has been successfully reserved. Below are your booking details:</p>
          
          <div style="background-color: #1e293b; border-radius: 8px; padding: 20px; margin-bottom: 24px; border: 1px solid #334155;">
            <p style="margin: 0 0 12px 0; color: #94a3b8; font-size: 14px;">BOOKING ID: <span style="color: #f1f5f9; font-weight: bold; float: right;">${bookingId}</span></p>
            <p style="margin: 0 0 12px 0; color: #94a3b8; font-size: 14px;">ARRIVAL TIME: <span style="color: #f1f5f9; font-weight: bold; float: right;">${arrivalTime}</span></p>
            <p style="margin: 0 0 12px 0; color: #94a3b8; font-size: 14px;">PARKING SLOT: <span style="color: #f1f5f9; font-weight: bold; float: right;">${parkingSlot}</span></p>
            <p style="margin: 0; color: #94a3b8; font-size: 14px;">LICENSE PLATE: <span style="color: #f1f5f9; font-weight: bold; float: right;">${licensePlate}</span></p>
          </div>
          
          <div style="text-align: center; margin-bottom: 24px;">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${bookingId}&bgcolor=1e293b&color=60a5fa" alt="Booking QR Code" style="border-radius: 8px; border: 4px solid #3b82f6;" />
            <p style="color: #94a3b8; font-size: 13px; margin-top: 12px;">Scan this QR code at the Kiosk upon arrival.</p>
          </div>
          
          <p style="color: #94a3b8; font-size: 13px; text-align: center; border-top: 1px solid #334155; padding-top: 16px; margin: 0;">
            Need help? Reply to this email or visit our <a href="#" style="color: #60a5fa; text-decoration: none;">Help Center</a>.
          </p>
        </div>
      </div>
    `,
  });
};

/**
 * Send Booking Reminder Email
 */
const sendBookingReminderEmail = async (toEmail, bookingDetails) => {
  const transporter = createTransporter();
  const { bookingId, arrivalTime, parkingSlot } = bookingDetails;
  
  await transporter.sendMail({
    from: `"VALO Parking" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Action Required: Your Parking Reservation is Soon',
    html: `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #050505; color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
        
        <!-- Header Banner -->
        <div style="background: #000000; padding: 25px; text-align: center; border-bottom: 3px solid #FFDF00;">
          <img src="https://res.cloudinary.com/dlelhpfjn/image/upload/v1780239706/valo_parking/assets/xrgz2v4wkd84qyipa9p4.png" alt="VALO PARKING" style="max-height: 50px; width: auto; margin: 0 auto; display: block;" />
        </div>
        <div style="padding: 32px;">
          <h2 style="color: #f1f5f9; margin-top: 0; margin-bottom: 16px; font-size: 20px;">Upcoming Reservation ⏰</h2>
          <p style="color: #cbd5e1; line-height: 1.6; margin-bottom: 24px;">This is a friendly reminder that your parking reservation starts soon. Please plan to arrive on time to ensure a smooth check-in.</p>
          
          <div style="background-color: #1e293b; border-radius: 8px; padding: 20px; margin-bottom: 24px; border: 1px solid #334155;">
            <p style="margin: 0 0 12px 0; color: #94a3b8; font-size: 14px;">BOOKING ID: <span style="color: #f1f5f9; font-weight: bold; float: right;">${bookingId}</span></p>
            <p style="margin: 0 0 12px 0; color: #94a3b8; font-size: 14px;">ARRIVAL TIME: <span style="color: #eab308; font-weight: bold; float: right;">${arrivalTime}</span></p>
            <p style="margin: 0; color: #94a3b8; font-size: 14px;">PARKING SLOT: <span style="color: #f1f5f9; font-weight: bold; float: right;">${parkingSlot}</span></p>
          </div>
          
          <p style="color: #94a3b8; font-size: 13px; margin-top: 24px;">If you need to change or cancel your booking, please do so via the ValoParking app at least 30 minutes prior to arrival.</p>
        </div>
      </div>
    `,
  });
};

/**
 * Send Booking Cancellation Email
 */
const sendBookingCancellationEmail = async (toEmail, bookingDetails) => {
  const transporter = createTransporter();
  const { bookingId, cancellationTime } = bookingDetails;
  
  await transporter.sendMail({
    from: `"VALO Parking" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Booking Cancelled — VALO Parking',
    html: `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #050505; color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
        
        <!-- Header Banner -->
        <div style="background: #000000; padding: 25px; text-align: center; border-bottom: 3px solid #FFDF00;">
          <img src="https://res.cloudinary.com/dlelhpfjn/image/upload/v1780239706/valo_parking/assets/xrgz2v4wkd84qyipa9p4.png" alt="VALO PARKING" style="max-height: 50px; width: auto; margin: 0 auto; display: block;" />
        </div>
        <div style="padding: 32px;">
          <h2 style="color: #f1f5f9; margin-top: 0; margin-bottom: 16px; font-size: 20px;">Booking Cancelled ❌</h2>
          <p style="color: #cbd5e1; line-height: 1.6; margin-bottom: 24px;">Your parking reservation has been successfully cancelled. If a refund is applicable based on our cancellation policy, it will be processed to your Valo wallet or original payment method shortly.</p>
          
          <div style="background-color: #1e293b; border-radius: 8px; padding: 20px; margin-bottom: 24px; border: 1px solid #334155;">
            <p style="margin: 0 0 12px 0; color: #94a3b8; font-size: 14px;">BOOKING ID: <span style="color: #f1f5f9; font-weight: bold; float: right;">${bookingId}</span></p>
            <p style="margin: 0; color: #94a3b8; font-size: 14px;">CANCELLED AT: <span style="color: #f1f5f9; font-weight: bold; float: right;">${cancellationTime}</span></p>
          </div>
          
          <p style="color: #94a3b8; font-size: 13px; text-align: center; border-top: 1px solid #334155; padding-top: 16px; margin: 0;">
            We hope to see you again soon at ValoParking.
          </p>
        </div>
      </div>
    `,
  });
};

const sendKioskCheckInEmail = async (toEmail, checkInDetails) => {
  const transporter = createTransporter();
  const { sessionId, checkInTime, expectedCheckoutTime, duration, parkingSlot, licensePlate, vehicleType } = checkInDetails;
  
  await transporter.sendMail({
    from: `"VALO Parking" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Vehicle Checked In — VALO Parking',
    html: `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #050505; color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
        
        <!-- Header Banner -->
        <div style="background: #000000; padding: 25px; text-align: center; border-bottom: 3px solid #FFDF00;">
          <img src="https://res.cloudinary.com/dlelhpfjn/image/upload/v1780239706/valo_parking/assets/xrgz2v4wkd84qyipa9p4.png" alt="VALO PARKING" style="max-height: 40px; width: auto; margin: 0 auto; display: block;" />
          <p style="color: #888; font-size: 14px; margin-top: 15px; margin-bottom: 0; letter-spacing: 1px; text-transform: uppercase;">Smart Kiosk Check-In</p>
        </div>

        <div style="padding: 40px 30px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #ffffff; margin: 0 0 10px 0; font-size: 24px; font-weight: 600;">Check-In Successful <span style="font-size: 24px;">🏎️</span></h2>
            <p style="color: #a3a3a3; line-height: 1.6; margin: 0; font-size: 15px;">Your vehicle has successfully entered the parking lot. We'll keep it safe! Here are your session details:</p>
          </div>
          
          <!-- Details Card -->
          <div style="background-color: #121212; border-radius: 12px; padding: 25px; border: 1px solid #222;">
            
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 2;">
              <tr>
                <td style="color: #888; text-transform: uppercase; letter-spacing: 1px; font-size: 12px;">Session ID</td>
                <td style="color: #ffffff; font-weight: bold; text-align: right; font-size: 16px;">#${sessionId}</td>
              </tr>
              <tr><td colspan="2"><hr style="border: 0; border-top: 1px dashed #333; margin: 12px 0;"></td></tr>
              
              <tr>
                <td style="color: #888; text-transform: uppercase; letter-spacing: 1px; font-size: 12px;">Check-In Time</td>
                <td style="color: #FFDF00; font-weight: bold; text-align: right;">${checkInTime}</td>
              </tr>
              <tr><td colspan="2"><hr style="border: 0; border-top: 1px dashed #333; margin: 12px 0;"></td></tr>
              
              ${expectedCheckoutTime ? `
              <tr>
                <td style="color: #888; text-transform: uppercase; letter-spacing: 1px; font-size: 12px;">Expected Checkout</td>
                <td style="color: #FFDF00; font-weight: bold; text-align: right;">${expectedCheckoutTime} <span style="color: #555; font-weight: normal; font-size: 12px;">(${duration} hrs)</span></td>
              </tr>
              <tr><td colspan="2"><hr style="border: 0; border-top: 1px dashed #333; margin: 12px 0;"></td></tr>
              ` : ''}

              <tr>
                <td style="color: #888; text-transform: uppercase; letter-spacing: 1px; font-size: 12px;">License Plate</td>
                <td style="color: #ffffff; font-weight: bold; text-align: right; font-size: 18px; letter-spacing: 1px;">${licensePlate}</td>
              </tr>
              <tr><td colspan="2"><hr style="border: 0; border-top: 1px dashed #333; margin: 12px 0;"></td></tr>
              
              <tr>
                <td style="color: #888; text-transform: uppercase; letter-spacing: 1px; font-size: 12px;">Vehicle Type</td>
                <td style="color: #ffffff; font-weight: bold; text-align: right; text-transform: capitalize;">${vehicleType}</td>
              </tr>
              <tr><td colspan="2"><hr style="border: 0; border-top: 1px dashed #333; margin: 12px 0;"></td></tr>
              
              <tr>
                <td style="color: #888; text-transform: uppercase; letter-spacing: 1px; font-size: 12px;">Parking Slot</td>
                <td style="color: #ffffff; font-weight: bold; text-align: right; font-size: 16px;">${parkingSlot}</td>
              </tr>
            </table>
            
          </div>
          
          <div style="text-align: center; margin-top: 40px;">
            <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}/customer/history" style="display: inline-block; background-color: #FFDF00; color: #000000; font-weight: bold; text-decoration: none; padding: 14px 32px; border-radius: 30px; letter-spacing: 1px; text-transform: uppercase; font-size: 14px;">View Live Session</a>
          </div>
          
        </div>
        
        <!-- Footer -->
        <div style="background-color: #000000; padding: 20px; text-align: center;">
          <p style="color: #666; font-size: 12px; margin: 0;">© 2026 Valo Parking. All rights reserved.</p>
          <p style="color: #444; font-size: 11px; margin: 5px 0 0 0;">Need help? Reply to this email or visit our help center.</p>
        </div>
      </div>
    `,
  });
};

/**
 * Send Checkout Email
 */
const sendCheckoutEmail = async (toEmail, checkoutDetails) => {
  const transporter = createTransporter();
  const { sessionId, checkInTime, checkOutTime, duration, parkingSlot, licensePlate, vehicleType, totalPrice } = checkoutDetails;
  
  await transporter.sendMail({
    from: `"VALO Parking" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Checkout Successful — VALO Parking',
    html: `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #050505; color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
        
        <!-- Header Banner -->
        <div style="background: #000000; padding: 25px; text-align: center; border-bottom: 3px solid #FFDF00;">
          <img src="https://res.cloudinary.com/dlelhpfjn/image/upload/v1780239706/valo_parking/assets/xrgz2v4wkd84qyipa9p4.png" alt="VALO PARKING" style="max-height: 40px; width: auto; margin: 0 auto; display: block;" />
          <p style="color: #888; font-size: 14px; margin-top: 15px; margin-bottom: 0; letter-spacing: 1px; text-transform: uppercase;">Smart Kiosk Checkout</p>
        </div>

        <div style="padding: 40px 30px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #ffffff; margin: 0 0 10px 0; font-size: 24px; font-weight: 600;">Checkout Successful <span style="font-size: 24px;">🏁</span></h2>
            <p style="color: #a3a3a3; line-height: 1.6; margin: 0; font-size: 15px;">Your vehicle has successfully exited the parking lot. Thank you for using VALO Parking! We hope to see you again soon.</p>
          </div>
          
          <!-- Details Card -->
          <div style="background-color: #121212; border-radius: 12px; padding: 25px; border: 1px solid #222;">
            
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 2;">
              <tr>
                <td style="color: #888; text-transform: uppercase; letter-spacing: 1px; font-size: 12px;">Session ID</td>
                <td style="color: #ffffff; font-weight: bold; text-align: right; font-size: 16px;">#${sessionId}</td>
              </tr>
              <tr><td colspan="2"><hr style="border: 0; border-top: 1px dashed #333; margin: 12px 0;"></td></tr>
              
              <tr>
                <td style="color: #888; text-transform: uppercase; letter-spacing: 1px; font-size: 12px;">Check-In Time</td>
                <td style="color: #ffffff; font-weight: bold; text-align: right;">${checkInTime}</td>
              </tr>
              <tr><td colspan="2"><hr style="border: 0; border-top: 1px dashed #333; margin: 12px 0;"></td></tr>
              
              <tr>
                <td style="color: #888; text-transform: uppercase; letter-spacing: 1px; font-size: 12px;">Check-Out Time</td>
                <td style="color: #ffffff; font-weight: bold; text-align: right;">${checkOutTime} <span style="color: #555; font-weight: normal; font-size: 12px;">(${duration})</span></td>
              </tr>
              <tr><td colspan="2"><hr style="border: 0; border-top: 1px dashed #333; margin: 12px 0;"></td></tr>

              <tr>
                <td style="color: #888; text-transform: uppercase; letter-spacing: 1px; font-size: 12px;">License Plate</td>
                <td style="color: #ffffff; font-weight: bold; text-align: right; font-size: 18px; letter-spacing: 1px;">${licensePlate}</td>
              </tr>
              <tr><td colspan="2"><hr style="border: 0; border-top: 1px dashed #333; margin: 12px 0;"></td></tr>
              
              <tr>
                <td style="color: #888; text-transform: uppercase; letter-spacing: 1px; font-size: 12px;">Total Price</td>
                <td style="color: #FFDF00; font-weight: bold; text-align: right; font-size: 18px;">$${totalPrice}</td>
              </tr>
            </table>
            
          </div>
          
          <div style="text-align: center; margin-top: 40px;">
            <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}/customer/history" style="display: inline-block; background-color: #FFDF00; color: #000000; font-weight: bold; text-decoration: none; padding: 14px 32px; border-radius: 30px; letter-spacing: 1px; text-transform: uppercase; font-size: 14px;">View Parking History</a>
          </div>
          
        </div>
        
        <!-- Footer -->
        <div style="background-color: #000000; padding: 20px; text-align: center;">
          <p style="color: #666; font-size: 12px; margin: 0;">© 2026 Valo Parking. All rights reserved.</p>
          <p style="color: #444; font-size: 11px; margin: 5px 0 0 0;">Need help? Reply to this email or visit our help center.</p>
        </div>
      </div>
    `,
  });
};

const sendSpendRewardEmail = async (toEmail, voucher) => {
  const benefit = voucher.benefitSnapshot;
  const expiry = new Date(voucher.expiresAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const detail = benefit.type === 'FIXED_DISCOUNT'
    ? `Giảm ${benefit.discountAmount.toLocaleString('vi-VN')} VND`
    : benefit.type === 'PERCENT_DISCOUNT' ? `Giảm ${benefit.discountPercent}%` : 'Miễn phí dịch vụ được ghi trên voucher';
  const minimum = Number(benefit.minimumAmount || 0).toLocaleString('vi-VN');
  const rewardsUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/customer/rewards`;
  const voucherCode = voucher.code || `VALO-${String(voucher._id).slice(-8).toUpperCase()}`;
  return createTransporter({ connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000 }).sendMail({
    from: `"VALO Parking" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    messageId: `<voucher-${voucher._id}@valo-parking.local>`,
    subject: 'Bạn vừa nhận được voucher từ VALO Parking',
    text: [
      `Bạn đã nhận voucher: ${benefit.name}`,
      detail,
      `Đơn tối thiểu: ${minimum} VND.`,
      `Hạn sử dụng: ${expiry} (giờ Việt Nam).`,
      'Voucher dành riêng cho tài khoản của bạn và chỉ sử dụng một lần cho mỗi booking.',
      rewardsUrl,
    ].join('\n\n'),
    html: `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Bạn có một voucher mới từ VALO Parking</title></head><body style="margin:0;padding:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#e9edf0"><div style="display:none;max-height:0;overflow:hidden">${detail} — một món quà từ VALO Parking dành riêng cho bạn.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff"><tr><td align="center" style="padding:30px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#050505;border-radius:16px;overflow:hidden"><tr><td align="center" style="padding:25px 24px 24px;background:#000;border-bottom:3px solid #ffe500"><img src="https://id-preview--1e58645b-edcc-4b45-96e3-fcbbfc049c18.lovable.app/__l5e/assets-v1/b8f2f965-863f-4465-b4e2-2f1b27de3255/valo-logo.png" alt="VALO Parking" width="60" height="57" style="display:block;width:60px;height:57px;border:0"></td></tr><tr><td style="padding:32px 32px 20px"><p style="margin:0 0 14px;font-size:12px;font-weight:bold;letter-spacing:1.5px;color:#00d56a">VOUCHER MỚI</p><h1 style="font-size:24px;line-height:1.35;margin:0 0 20px;font-weight:700;color:#e9edf0">Một đặc quyền dành riêng cho bạn.</h1><p style="font-size:14px;line-height:1.7;margin:0;color:#c7d0db">Xin chào,<br>Cảm ơn bạn đã đồng hành cùng VALO Parking. Đây là món quà dành cho hành trình tiếp theo của bạn.</p></td></tr><tr><td style="padding:0 32px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #34404c"><tr><td colspan="2" style="padding:20px 0 18px;border-bottom:1px solid #34404c"><p style="margin:0 0 7px;font-size:11px;color:#9ba8b8">ĐẶC QUYỀN CỦA BẠN</p><p style="margin:0;font-size:21px;font-weight:bold;line-height:1.4;color:#ffe500">${benefit.name}</p><p style="margin:6px 0 0;font-size:12px;color:#9ba8b8">${detail}</p></td></tr><tr><td style="padding:15px 8px 15px 0;font-size:12px;color:#9ba8b8;border-bottom:1px solid #34404c">MÃ VOUCHER</td><td align="right" style="padding:15px 0;font-family:Courier New,monospace;font-size:14px;word-break:break-word;font-weight:bold;color:#e9edf0;border-bottom:1px solid #34404c">${voucherCode}</td></tr><tr><td style="padding:15px 8px 15px 0;font-size:12px;color:#9ba8b8;border-bottom:1px solid #34404c">ĐƠN TỐI THIỂU</td><td align="right" style="padding:15px 0;font-size:13px;font-weight:bold;color:#e9edf0;border-bottom:1px solid #34404c">${minimum} VND</td></tr><tr><td style="padding:15px 8px 15px 0;font-size:12px;color:#9ba8b8;border-bottom:1px solid #34404c">CÓ HIỆU LỰC ĐẾN</td><td align="right" style="padding:15px 0;font-size:13px;font-weight:bold;color:#e9edf0;border-bottom:1px solid #34404c">${expiry}</td></tr></table></td></tr><tr><td align="center" style="padding:30px 24px 26px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td align="center" bgcolor="#ffe500" style="border-radius:28px;background:#ffe500"><a href="${rewardsUrl}" style="display:inline-block;padding:16px 28px;color:#000;text-decoration:none;font-weight:bold;font-size:13px;line-height:1.2">XEM VOUCHER CỦA TÔI</a></td></tr></table><p style="font-size:11px;line-height:1.6;color:#9ba8b8;margin:17px 0 0">Giờ Việt Nam</p></td></tr><tr><td style="padding:0 32px 26px;font-size:11px;line-height:1.8;color:#9ba8b8">Voucher chỉ dành cho tài khoản của bạn và được sử dụng một lần.<br>Mỗi booking áp dụng tối đa một voucher.</td></tr><tr><td align="center" style="padding:23px 24px 20px;background:#000;border-radius:0 0 16px 16px;font-size:11px;color:#707070;line-height:1.8">© 2026 Valo Parking. All rights reserved.<br><span style="font-size:10px">Đỗ xe an tâm. Hành trình trọn vẹn.</span></td></tr></table></td></tr></table></body></html>`,
  });
};

module.exports = {
  sendSpendRewardEmail,
  generateOTP, 
  sendOTPEmail, 
  sendResetPasswordEmail,
  sendBookingConfirmationEmail,
  sendBookingReminderEmail,
  sendBookingCancellationEmail,
  sendKioskCheckInEmail,
  sendCheckoutEmail
};
