const nodemailer = require("nodemailer");

async function sendMail(mailOptions) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMPT_HOST,
    service: process.env.SMPT_SERVICE,
    port: process.env.SMPT_PORT,
    secure: process.env.SMPT_SECURE,
    auth: {
      user: process.env.SMPT_USER,
      pass: process.env.SMPT_PASS,
    },
    from: process.env.SMPT_USER,
  });

  await transporter.sendMail(mailOptions);
  console.log("Message sent");
}

module.exports = sendMail;
