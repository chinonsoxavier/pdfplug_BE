const router = require("express").Router();
const { pdftoword } = require("../controller/pdf_to_word");
const tools_controller = require("../controller/tools_controller");
const { upload } = require("../utils/multer");

router.post("/test", (req, res) => {
  res.send("Tools API is working!");
});

router.post("/convert-pdf-to-word", upload.single("pdfFile"), pdftoword);

// router.post(
//   "/convert-word-to-pdf",
//   upload.single("wordFile"),
//   tools_controller.WordToPdf
// );
router.get("/download/:fileId", tools_controller.download);

module.exports = router;
