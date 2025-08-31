const userModel = require("../models/user_model");
const fileModel = require("../models/file_model");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const mongoose = require("mongoose");
const { ObjectId } = mongoose.Types;
const downloadDir = path.join("downloads");
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir);
}
exports.recentActivities = async (req, res) => {
  console.log("worked!");
  try {
    const userId = req.session?.passport?.user;
    const guestId = req.session?.guestId;

    let clientId;
    if (userId) {
      clientId = userId;
    } else if (guestId) {
      clientId = guestId;
    } else {
      console.log("recent activity found 1");
      return res
        .status(200)
        .json({ recentActivities: [], message: "No recent activities found." });
    }

   const activities = await fileModel
     .find({ userId: clientId })
     .sort({ createdAt: -1 })
     .limit(10);
    const users = await userModel.find();
    // const FileModels = await FileModel.find();

    console.log("1", activities);
    console.log("1 users", users);
    // console.log("1 files", FileModels);
    if (activities.length === 0) {
      console.log("no recent found 1", activities);
      console.log(clientId);

      return res
        .status(200)
        .json({ recentActivities: [], message: "No recent activities found." });
    }

    console.log("recent found 1");
    res.status(200).json({ recentActivities: activities });
  } catch (error) {
    console.error("Error fetching recent activities:", error);
    res
      .status(500)
      .json({ message: "An error occurred while fetching recent activities." });
  }
};

exports.download = async (req, res) => {
  try {
    const Id = req.params.fileId;

    // 1. Validate the ID first to prevent unnecessary database queries and errors
    if (!ObjectId.isValid(Id)) {
      return res
        .status(400)
        .json({ message: "Error: Invalid file ID format." });
    }

    // 2. Convert the valid string ID to an ObjectId
    const fileId = new ObjectId(Id);

    // 3. Find the file in the database
    const file = await fileModel.findOne({ _id: fileId });

    // 4. Check if a document was found
    if (file) {
      // 5. Send the file URL to the client
      const fileUrl = file.fileUrl;
      res.redirect(fileUrl);
      return;
      // return res.status(200).json(fileUrl);
    }

    // 6. If no document was found
    return res.status(404).json({ message: "File not found!" });
  } catch (error) {
    // Catch unexpected errors (e.g., database connection issues)
    console.error(error);
    res.status(500).json({ message: "An unexpected server error occurred." });
  }
};

cron.schedule("*/10 * * * *", async () => {
  const oneHourAgo = new Date(Date.now() - 3600 * 1000);
  const oldFiles = await fileModel.find({ createdAt: { $lt: oneHourAgo } });
  for (let file of oldFiles) {
    try {
      if (fs.existsSync(file.fileUrl)) {
        fs.unlinkSync(file.fileUrl);
      }
      await fileModel.findByIdAndDelete(file._id);
      console.log("file deleted");
    } catch (error) {
      console.log("failed to delete file");
    }
  }
});

exports.getClientIdAndProcess = (req, res, callback) => {
  const guestId = req.session?.guestId;
  const userId = req.session?.passport?.user;

  if (userId) {
    return callback(userId);
  }
  if (guestId) {
    return callback(guestId);
  }
  const newGuestId = new mongoose.Types.ObjectId().toString();
  req.session.guestId = newGuestId;
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ error: "Failed to save session" });
    }
    callback(newGuestId);
  });
};