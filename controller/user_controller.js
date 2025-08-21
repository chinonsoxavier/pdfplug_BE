const CryptoJS = require("crypto-js");
const userServices = require("../services/user_services");

exports.UpdateUserDetails = async (req, res) => {
  try {
    const filename = req?.file?.filename;
    const fileurl = `${req.protocol}://${req.get("host")}/uploads/${filename}`;
    const id = req.session.passport.user;
    const updatedUserDetails = {
      userName: req.body.userName,
      phoneNumber: req.body.phoneNumber,
      email: req.body.email,
    }
    await userServices.updateUserDetails(id, updatedUserDetails, fileurl, filename);
    res.status(200).json("your account has been updated successfully");
    // }
  } catch (error) {
    console.log(error);

    res.status(400).json(error);
  }
};

exports.ChangeUserPassword = async (req, res) => {
  const email = req.user.email;
  const existingUser = await userServices.getUserByEmail(email);
  const oldpassword = req.body?.password;
  const newPassword = req.body.newPassword;
  const comfirmNewPassword = req.body.comfirmNewPassword;
  const userId = req.query.id;
  console.log(email);
  const bytes = CryptoJS.AES.decrypt(
    existingUser.password,
    process.env.CRYPTO_JS_SECRET_KEY
  );
  const originalPassword = bytes.toString(CryptoJS.enc.Utf8);
console.log(originalPassword, "originalPassword");
console.log(oldpassword, "oldPassword");
  try {
    if (!oldpassword) {
      return res.status(403).json("Comfirm Current Password");
    } else if (originalPassword != oldpassword) {
      return res.status(403).json("Current Password is incorrect");
    } else if (newPassword !== comfirmNewPassword) {
      return res.status(403).json("Comfirm Password does not match ");
    }
    await userServices.changeUserPassword(userId,CryptoJS.AES.encrypt(
      newPassword,
      process.env.CRYPTO_JS_SECRET_KEY
    ).toString());

    res.status(200).json("your password has been changed!");
  } catch (error) {
    console.log(error);
    res.status(401).json(error);
  }
};

exports.GetUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await userServices.getUserById(userId);
        if (user) {
         return res.status(200).json(user);
        };
        return res.status(200).json("could not find user")
  } catch (error) {
    console.log(error);
    res.status(400).json(error);
  }
}
