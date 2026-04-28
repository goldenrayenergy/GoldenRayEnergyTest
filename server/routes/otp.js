import express from 'express';
const router = express.Router();

// In-memory store: phone -> { otp, expiresAt }
const otpStore = new Map();

const generate = () => Math.floor(100000 + Math.random() * 900000).toString();

// POST /api/otp/send
router.post('/send', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number is required.' });

  const otp = generate();
  otpStore.set(phone, { otp, expiresAt: Date.now() + 5 * 60 * 1000 }); // 5 min expiry

  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_PHONE_NUMBER;

  // Real SMS via Twilio (when keys are configured)
  if (sid && token && from) {
    try {
      const body = new URLSearchParams({
        To:   phone,
        From: from,
        Body: `Your GoldenRay Energy verification code is: ${otp}. Valid for 5 minutes.`,
      });
      const resp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method:  'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        }
      );
      if (resp.ok) return res.json({ success: true, message: 'OTP sent via SMS.' });
      const err = await resp.json();
      console.error('Twilio error:', err);
    } catch (e) {
      console.error('Twilio fetch error:', e.message);
    }
  }

  // Demo fallback — return OTP in response so dev can test without Twilio
  res.json({ success: true, message: 'Demo mode — OTP returned in response.', demoOtp: otp });
});

// POST /api/otp/verify
router.post('/verify', (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP are required.' });

  const record = otpStore.get(phone);
  if (!record)                  return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
  if (Date.now() > record.expiresAt) { otpStore.delete(phone); return res.status(400).json({ error: 'OTP expired. Please request a new one.' }); }
  if (record.otp !== String(otp))     return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });

  otpStore.delete(phone);
  res.json({ success: true, message: 'Phone number verified.' });
});

export default router;
