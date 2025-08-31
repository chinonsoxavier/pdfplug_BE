const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema({
  fileType: { type: String, required: true },
  fileUrl: { type: String, required: true },
  action: { type: String, required: true },
  fileName: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 3600,
  },
});

module.exports = mongoose.model("files", fileSchema);
/*  */