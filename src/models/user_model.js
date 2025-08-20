const mongoose = require("mongoose");
const UserSchema = new mongoose.Schema(
  {
    googleId: { type: String, unique: true, sparse: true },
    facebookId: { type: String, unique: true, sparse: true },
    profileId: { type: String, unique: true, sparse: true },
    githubId: { type: String, unique: true, sparse: true },
    userName: { type: String, required: true },
    profilePic: { type: String, default: "" },
    provider: { type: String },
    email: { type: String, unique: true },
    password: { type: String },
    isAdmin: { type: Boolean, default: false },
    credits: { type: Number, default: 0 },
    isVerified: { type: Boolean, default: false },
    refreshToken: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
