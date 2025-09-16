const axios = require("axios"); // Install with 'npm install axios'
const userModel = require("../models/user_model");
const fileModel = require("../models/file_model");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const mongoose = require("mongoose");
// const file_model = require("../models/file_model");
const { ObjectId } = mongoose.Types;
const downloadDir = path.join("downloads");
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir);
}
exports.recentActivities = async (req, res) => {
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
      const fileName = file.fileName;
      res.status(200).json({ fileName: fileName, fileUrl: fileUrl });
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

exports.deleteFile = async (req, res) => {
  try {
    const { fileId } = req.params; // we’ll send :fileId in the route param

    // 1. Find the file in MongoDB
    const fileDoc = await fileModel.findById(fileId);
    console.log(fileDoc);
    console.log(fileId);
    if (!fileDoc) {
      return res.status(404).json({ error: "File not found in database" });
    }
    // 2. Derive the local path from stored fileUrl
    // Example: http://localhost:5000/downloads/2025-08-31T14-30-00.pdf
    const fileUrl = fileDoc.fileUrl;
    const relativePath = fileUrl.split(`${req.get("host")}/`)[1]; // take path after host
    const localPath = path.join(process.cwd(), relativePath);
    console.log(relativePath, "relative path");
    console.log(localPath, "local path");
    // 3. Delete the file from filesystem (if it exists)
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }

    // 4. Delete the record from MongoDB
    await fileModel.findByIdAndDelete(fileId);

    res.status(200).json({ message: "File and record deleted successfully" });
  } catch (err) {
    console.error("Error deleting file:", err);
    res.status(500).json({ error: "Failed to delete file" });
  }
};

exports.getFileInfo = async (req, res) => {
  try {
    const id = req.params.id;
    const FileModel = await fileModel.findOne({ _id: id });

    if (FileModel === null || undefined) {
      res.status(404).json("file not found in database");
      return;
    }

    res.status(200).json({
      fileUrl: FileModel.fileUrl,
      fileType: FileModel.fileType,
      fileId: FileModel?._id,
      fileName: FileModel.fileName,
    });
  } catch (error) {
    console.log(error);
  }
};

const verifyDownloadId = (req, res) => {
  try {
    const id = req.params.id;
  } catch (error) {
    console.log(error);
    res.status(400).json("could not verify download id!");
  }
};

// Cron job to clean up old files
cron.schedule("0 * * * *", async () => {
  console.log("Running file cleanup job...");
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Find files older than 1 hour
    const oldFiles = await File.find({
      createdAt: { $lt: oneHourAgo },
    }).lean();

    for (const file of oldFiles) {
      try {
        // Convert relative path to absolute path
        const absolutePath = path.resolve(file.fileUrl);
        if (fs.existsSync(absolutePath)) {
          fs.unlinkSync(absolutePath);
          console.log(`Deleted file: ${file.fileName}`);
        }

        // Delete from database
        await File.findByIdAndDelete(file._id);
      } catch (error) {
        console.error(`Error processing file ${file._id}:`, error.message);
      }
    }

    console.log(`Cleanup completed. Deleted ${oldFiles.length} files.`);
  } catch (error) {
    console.error("Error in cron job:", error.message);
  }
});

console.log("Cron job scheduled to run hourly.");

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
