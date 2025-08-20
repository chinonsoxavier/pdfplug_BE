const User = require("../models/user_model.js");
// module.exports = {
exports.createUser = async (newUser) => {
  const user = new User({
    userName: newUser.userName,
    email: newUser.email,
    password: newUser.password,
    profilePic:
      "https://res.cloudinary.com/dghetii0z/image/upload/v1748602121/default-profile-picture-avatar-photo-placeholder-vector-illustration_v5eqsc.jpg",
  });
  // await user.save();
  return user;
};

exports.verifyUser = async (user) => {
  console.log(user.email);

  const verifiedUser = await User.findOneAndUpdate(
    { email: user.email, userName: user.userName },
    {
      isVerified: true,
    },
    { new: true }
  );
  return verifiedUser;
};
