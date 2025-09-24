const {
  ServicePrincipalCredentials,
  PDFServices,
  MimeType,
  CombinePDFJob, // Add this
  CombinePDFResult, // Add this
  SDKError,
  ServiceUsageError,
  ServiceApiError,
  CombinePDFParams,
} = require("@adobe/pdfservices-node-sdk");
const fs = require("fs");
const path = require("path");
const fileModel = require("../models/file_model");
const mongoose = require("mongoose");
const { promisify } = require("util");
const unlinkAsync = promisify(fs.unlink);
const downloadDir = path.join("downloads"); // Ensure this path is correct

// Function to generate output file path based on extension (reused from previous examples)
function createOutputFilePath(ext) {
  const filePath = downloadDir;
  const date = new Date();
  const dateString =
    date.getFullYear() +
    "-" +
    ("0" + (date.getMonth() + 1)).slice(-2) +
    "-" +
    ("0" + date.getDate()).slice(-2) +
    "T" +
    ("0" + date.getHours()).slice(-2) +
    "-" +
    ("0" + date.getMinutes()).slice(-2) +
    "-" +
    ("0" + date.getSeconds()).slice(-2);
  return `${filePath}/${dateString}.${ext}`;
}

// Reusable function for client ID determination (as in previous examples)
const getClientIdAndProcess = (req, res, callback) => {
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
exports.mergePdfs = async (req, res) => {
  if (!req.files || req.files.length < 2) {
    return res
      .status(400)
      .json({ error: "Please upload at least two PDF files to merge." });
  }

  console.log(req.files);

  getClientIdAndProcess(req, res, async (clientId) => {
    let readStreams = [];

    try {
      // 1. Setup credentials
      const credentials = new ServicePrincipalCredentials({
        clientId: process.env.PDF_SERVICES_CLIENT_ID,
        clientSecret: process.env.PDF_SERVICES_CLIENT_SECRET,
      });

      const pdfServices = new PDFServices({ credentials });

      // 2. Build readStreams for uploaded PDFs
      const streamAssets = req.files.map((file) => {
        const readStream = fs.createReadStream(file.path);
        readStreams.push(readStream);
        return { readStream, mimeType: MimeType.PDF };
      });

      // 3. Upload assets to Adobe
      const inputAssets = await pdfServices.uploadAssets({
        streamAssets,
      });

      if (inputAssets.length < 2) {
        return res
          .status(400)
          .json({ error: "At least two valid PDFs are required." });
      }

      // 4. Create Combine parameters
      const params = new CombinePDFParams();
      inputAssets.forEach((asset) => params.addAsset(asset));

      // 5. Create and submit the job
      const job = new CombinePDFJob({ params });
      const pollingURL = await pdfServices.submit({ job });

      const pdfServicesResponse = await pdfServices.getJobResult({
        pollingURL,
        resultType: CombinePDFResult,
      });

      // 6. Get result content
      const resultAsset = pdfServicesResponse.result.asset;
      const streamAsset = await pdfServices.getContent({ asset: resultAsset });

      // 7. Save merged PDF
      const outputFilePath = createOutputFilePath("pdf");
      const outputStream = fs.createWriteStream(outputFilePath);
      streamAsset.readStream.pipe(outputStream);

      await new Promise((resolve) => outputStream.on("finish", resolve));

      const downloadUrl = `${req.protocol}s://${req.get(
        "host"
      )}/${outputFilePath}`;

      // 8. Save file record in DB
      const newFile = await fileModel.create({
        fileType: "pdf",
        fileUrl: downloadUrl,
        userId: clientId,
        action: "Merged PDF files",
        fileName: `pdfplug_merged${Date.now()}.pdf`,
        icon: "merge_pdf",
      });
      res.status(200).json({
        message: "PDFs merged successfully",
        fileId: newFile._id,
        downloadUrl,
        fileUrl: downloadUrl,
      });
    } catch (err) {
      console.error("Exception while merging PDFs:", err);

      if (
        err instanceof SDKError ||
        err instanceof ServiceUsageError ||
        err instanceof ServiceApiError
      ) {
        return res
          .status(500)
          .json({ error: `Adobe SDK Error: ${err.message}` });
      }

      res.status(500).json({ error: "Failed to merge PDFs." });
    } finally {
      // Cleanup
      req.files.map(async (file, index) => {
        await safeUnlink(file.path, file.originalname);
      });
      readStreams.forEach((s) => s?.destroy());
    }
  });
};

const safeUnlink = async (filePath, fileName = "unknown") => {
  if (!filePath) {
    console.warn(`No file path provided for deletion (file: ${fileName})`);
    return;
  }
  try {
    if (fs.existsSync(filePath)) {
      await unlinkAsync(filePath);
      console.log(`Successfully deleted file: ${filePath}`);
    } else {
      console.warn(`File not found for deletion: ${filePath}`);
    }
  } catch (err) {
    console.error(`Failed to delete file ${filePath}:`, err.message);
  }
};
