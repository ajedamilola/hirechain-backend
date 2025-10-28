import nodemailer from "nodemailer";
import ejs from "ejs";
import path from "path";
import "dotenv/config";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    method: "LOGIN"
  },
  tls: {
    minVersion: "TLSv1.2",
    servername: process.env.SMTP_HOST
  },
  logger: true,
  debug: true
});

export async function sendEmail({ to, subject, data, template }) {
  try {
    const html = await ejs.renderFile(
      path.resolve("templates", template),
      data
    );

    const options = {
      from: process.env.SMTP_FROM,
      to,
      subject,
      data,
      html
    };
    const info = await transporter.sendMail(options);
    console.log("Email sent successfully");
    console.log({ info });
    return true
  } catch (error) {
    console.error(error);
    return false
  }
}
