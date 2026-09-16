const { interpretBookingMessage } = require('../services/aiBookingInterpreter');

exports.interpret = async (req, res) => {
  try {
    const result = await interpretBookingMessage({
      prompt: req.body?.prompt,
      draft: req.body?.draft,
      today: req.body?.today,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Không thể xử lý yêu cầu AI lúc này.',
    });
  }
};
