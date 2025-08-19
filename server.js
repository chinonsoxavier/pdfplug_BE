const express = require("express");
const app = express();
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();

app.use(express.json());
const forms = require("multer");
const { default: axios } = require("axios");
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: "File upload error",
      error: err.message,
    });
  }
  next(err);
});

require("dotenv").config();
const multer = require("multer");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);
mongoose
  .connect(process.env.MONGODB_URI, {})
  .then(() => console.log("Db connection Successfully"))
  .catch((err) => console.log(err));

const allowedOrigins = [
  process.env.CLIENT_URL_DEV,
  process.env.CLIENT_URL_PRO,
].filter(Boolean);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: "File upload error",
      error: err.message,
    });
  }
  next(err);
});

const toolsRoutes = require("./src/routes/tools_routes");
const { upload } = require("./src/utils/multer");
app.use("/api/v1/tools/", toolsRoutes);
app.post("/upload_files", upload.array("files"), uploadFiles);
app.use("/uploads", express.static("uploads"));
app.use("/downloads", express.static("downloads"));

function uploadFiles(req, res) {
  console.log(req.body);
  console.log(req.files);
  res.json({ message: "Successfully uploaded files" });
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
