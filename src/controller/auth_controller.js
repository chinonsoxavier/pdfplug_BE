const authServices = require("../services/auth_services.js");
const sendMail = require("./../services/emails/email_service.js");
const userServices = require("./../services/user_services.js");
const CryptoJS = require("crypto-js");
const ejs = require("ejs");
const path = require("path");
const { GenerateToken, decodedToken } = require("../services/jwt_services.js");
const UserModel = require(".././models/user_model.js");

// Register
exports.createUser = async (req, res) => {
  try {
    const existingUser = await userServices.getUserByEmail(req.body.email);
    const userPayload = {
      email: req.body.email,
      userName: req.body.userName,
      password: CryptoJS.AES.encrypt(
        req.body.password,
        process.env.CRYPTO_JS_SECRET_KEY
      ).toString(),
    };
    if (existingUser !== null || existingUser) {
      if (!existingUser.isVerified) {
        return res
          .status(400)
          .json({
            message:
              "email not verified!check your email for verification token",
            status: "email not verified",
          });
      }
      return res
        .status(400)
        .json({
          message: "user with this email already exists",
          status: "email already exists",
        });
    }
    const newUser = await authServices.createUser(userPayload);
    const user = {
      email: newUser.email,
      userName: newUser.userName,
    };
    console.log(newUser);
    const activationToken = await GenerateToken(user, "access");
    const activationUrl = `${process.env.CLIENT_URL_PRO}/verify-email/${activationToken}`;
    const data = { email: user.email, activationUrl: activationUrl };
    const htmlContent = await ejs.renderFile(
      path.join("src", "services", "emails", "verifyEmail.ejs"),
      data
    );
    await sendMail({
      from: `Pdfplug ${process.env.SMPT_USER}`,
      to: req.body.email,
      subject: "Activate your Pdfplug account",
      html: htmlContent,
    });
    await newUser.save();
    return res.status(200).json({
      Message: `Account created Successfully! Please check your email ${newUser.email} to verify-email your account`,
    });
  } catch (error) {
    if (error.code == "EENVELOPE") {
      console.log("Email not Found");
      return res.status(400).json("Email not Found");
    }
    res.status(500).json(error);
    console.log(error);
    console.error("Failed to create user");
  }
};

// verify-email user email
exports.verifyUser = async (req, res) => {
  const token = req.params.token;
  const user = decodedToken(token);
  try {
    authServices.verifyUser(user);
    res.status(200).json({ message: "Email verified successfully" });
  } catch (err) {
    console.error("user verification failed");
    console.error(err);
    res.status(400).json("user verification failed");
  }
};

// refresh verification token
exports.ResendPasswordResetToken = async (req, res) => {
  const email = req.body.email;

  const user = await userServices.getUserByEmail(email);
  console.log(user);
  // const user = decodedToken(token);
  console.log(user, "refresh token user");
  try {
    const newVerificationToken = await GenerateToken(user, "access");
    const activationUrl = `${process.env.CLIENT_URL_PRO}/verify-email/${newVerificationToken}`;
    const data = { email: user.email, activationUrl: activationUrl };
    const htmlContent = await ejs.renderFile(
      path.join("src", "services", "emails", "resetPasswordEmail.ejs"),
      data
    );
    await sendMail({
      from: `Pdfplug ${process.env.SMPT_USER}`,
      to: user.email,
      subject: "Reset your Pdfplug password",
      html: htmlContent,
    });
    res.status(200).json("A new token has been sent to your email!");
  } catch (error) {
    console.log(error);
    res.status(400).json(error);
  }
};

exports.ResendVerificationToken = async (req, res) => {
  const email = req.body.email;
  const user = await userServices.getUserByEmail(email);
  console.log(user);
  // const user = decodedToken(token);
  console.log(user, "refresh token user");
  try {
    const newVerificationToken = await GenerateToken(user, "access");
    const activationUrl = `${process.env.CLIENT_URL_PRO}/verify-email/${newVerificationToken}`;
    const data = { email: user.email, activationUrl: activationUrl };
    const htmlContent = await ejs.renderFile(
      path.join("src", "services", "emails", "verifyEmail.ejs"),
      data
    );
    await sendMail({
      from: `Pdfplug ${process.env.SMPT_USER}`,
      to: user.email,
      subject: "Activate your Pdfplug account",
      html: htmlContent,
    });
    res
      .status(200)
      .json("A new verification token has been sent to your email!");
  } catch (error) {
    console.log(error);
    res.status(400).json(error);
  }
};

// login user
exports.LoginUser = async (req, res) => {
  const userEmail = req.query.email;
  const userPassword = req.query.password;
  console.log(req.query);
  if (!userEmail || !userPassword) {
    return res.status(400).json("Please provide email and password");
  }
  const existingUser = await userServices.getUserByEmail(userEmail);
  console.log(existingUser);
  const bytes = existingUser
    ? CryptoJS.AES?.decrypt(
        existingUser?.password,
        process.env.CRYPTO_JS_SECRET_KEY
      )
    : null;
  console.log(bytes.toString(CryptoJS.enc.Utf8));
  const originalPassword = bytes?.toString(CryptoJS.enc.Utf8);
  try {
    if (!existingUser.isVerified) {
      return res.status(400).json("please verify-email your email");
    }
    if (existingUser == null || existingUser.$isEmpty()) {
      return res
        .status(404)
        .json("user not found,Check your email and try again!");
    } else if (originalPassword !== userPassword) {
      return res.status(404).json("Password incorrect");
    }
    // await DeleteRefreshToken({ userId: existingUser._id });
    // const accessToken = await GenerateToken(existingUser, "access");
    // const refreshToken = await GenerateToken(existingUser, "refresh");
    // await GenerateRefreshToken(existingUser._id, refreshToken);
    const { password, ...info } = existingUser._doc;
    // req.session.user = "user2";
    // console.log(req.session.user);
    // req.session.user =  "...info, accessToken, refreshToken"
    req.session.passport = { ...info._id };
    // req.user = { ...info, accessToken, refreshToken };
    await MergeCart(req, res);
    // req.session.cookie.user = { ...info, accessToken, refreshToken };
    // res.cookie("userSession", "hiii", {
    //   httpOnly: true,
    //   secure: process.env.NODE_ENV === "PRODUCTION", // Set to true in production
    //   sameSite: "Lax", // or 'None' if needed
    //   maxAge: 24 * 60 * 60 * 1000,
    // });
    // req.session.user = "us";
    //  res.redirect("http://localhost:5173");

    return res.status(200).json("Logged in Successfully");
    // console.log(req.session)==;
  } catch (error) {
    console.log(error);
    console.error("Failed to login user");
    res.status(400).json("Error " + error);
  }
};

// login success
exports.LoginSuccess = async (req, res) => {
  try {
    const user = req.user;
    const userId = req.user.id;
    if (!user) {
      return res.send("could not find user");
    }
    res.status(200).json(user);
  } catch (error) {
    res.status(400).json(error);
  }
};

// reset-password
exports.ResetPasswordToken = async (req, res) => {
  const email = req.body.email;
  try {
    const user = await userServices.getUserByEmail(email);
    if (!user) {
      return res.status(404).json("User not found");
    }
    console.log(user);
    const resetPasswordToken = await GenerateToken(user, "access");
    const activationUrl = `${process.env.CLIENT_URL_PRO}/reset-password/${resetPasswordToken}`;
    const data = { email: user.email, activationUrl: activationUrl };
    const htmlContent = await ejs.renderFile(
      path.join("src", "services", "emails", "resetPasswordEmail.ejs"),
      data
    );
    await sendMail({
      from: `Pdfplug ${process.env.SMPT_USER}`,
      to: req.body.email,
      subject: "Reset your Pdfplug password",
      html: htmlContent,
    });
    res.status(200).json("A token has been sent to your email!");
  } catch (error) {
    console.log(error);
    res.status(400).json(error);
  }
};

exports.GetUser = async (req, res) => {
  try {
    const userId = req?.session?.passport?.user;
    console.log(userId, "userId");
    const User = await userServices.getUserById(userId);
    if (userId) {
      if (User == null) {
        return res.send("user not found");
      }
      return res.status(200).json({
        data: User,
        status: 200,
      });
    }
    res.status(404).json("User not Logged in");
  } catch (error) {
    res.status(401).json(error);
    console.log(error);
  }
};

exports.ChangeUserPassword = async (req, res) => {
  try {
    const token = req.params.token;
    const newPassword = CryptoJS.AES.encrypt(
      req.body.newPassword,
      process.env.CRYPTO_JS_SECRET_KEY
    ).toString();
    const decodedUser = decodedToken(token);
    console.log(decodedUser);
    await userServices.changeUserPassword(decodedUser.id, newPassword);
    res.status(200).json("password changed successfully");
  } catch (error) {
    console.log(error);
    res.status(400).json(error);
  }
};
