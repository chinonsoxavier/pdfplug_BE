const multer = require("multer");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, "pdfPlug" + Date.now() + "-" + file.originalname.trim());
  },
});

exports.upload = multer({ storage: storage });

// const upload = multer({ storage });
