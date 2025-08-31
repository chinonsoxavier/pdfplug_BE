const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { promisify } = require("util");
const unlinkAsync = promisify(fs.unlink);
const fileModel = require("../models/file_model");
const {
  ServicePrincipalCredentials,
  PDFServices,
  MimeType,
  PageRanges,
  RotatePagesParams,
  Angle,
  RotatePagesJob,
  RotatePagesResult,
} = require("@adobe/pdfservices-node-sdk");

// Ensure directories exist
const downloadDir = path.join("downloads");
const uploadDir = path.join("uploads");
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Function to generate output file path
function createOutputFilePath(ext) {
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
  return `${downloadDir}/${dateString}.${ext}`;
}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        
// Reusable function for client ID determination
const getClientIdAndProcess = (req, res, callback) => {
  const guestId = req.session?.guestId;
  const userId = req.session?.passport?.user;
  if (userId) {
    return callback(userId);
  }
  if (guestId) {
    console.log(guestId, "oldguest");
    return callback(guestId);
  }
  const newGuestId = new mongoose.Types.ObjectId().toString();
  req.session.guestId = newGuestId;
  console.log(newGuestId, "newGuest");
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ error: "Failed to save session" });
    }
    callback(newGuestId);
  });
};

// Helper function to parse page ranges from string format
const parsePageRanges = (rangesStr) => {
  const pageRanges = new PageRanges();
  if (!rangesStr) return pageRanges;

  const rangeParts = rangesStr.split(",");
  for (const part of rangeParts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((num) => parseInt(num.trim()));
      pageRanges.addRange(start, end);
    } else {
      const pageNum = parseInt(part.trim());
      pageRanges.addSinglePage(pageNum);
    }
  }
  return pageRanges;
};

// PDF Rotation endpoint
exports.RotatePdf = async (req, res) => {
  // Get parameters from request
  const angleSetting = req.body.angle || req.query.angle || "90";
  const pageRangesStr = req.body.pageRanges || req.query.pageRanges || "";

  getClientIdAndProcess(req, res, async (clientId) => {
    let outputFilePath = null;
    const inputFilePath = req.file?.path;

    try {
      // Validate input file
      if (!req.file || !fs.existsSync(inputFilePath)) {
        return res.status(400).json({
          error: `Input file not found at ${inputFilePath || "undefined"}`,
        });
      }

      // Validate file type
      if (!req.file.mimetype.match(/application\/pdf/)) {
        return res
          .status(400)
          .json({ error: `File '${req.file.originalname}' is not a PDF.` });
      }

      console.log(`Processing file: ${inputFilePath}`);

      // Read file into buffer and delete immediately
      const pdfBuffer = fs.readFileSync(inputFilePath);
      await safeUnlink(inputFilePath, req.file.originalname);

      // Initialize Adobe PDF Services
      const credentials = new ServicePrincipalCredentials({
        clientId: process.env.PDF_SERVICES_CLIENT_ID,
        clientSecret: process.env.PDF_SERVICES_CLIENT_SECRET,
      });

      const pdfServices = new PDFServices({ credentials });

      // Create input asset
      const inputAsset = await pdfServices.upload({
        readStream: fs.createReadStream(inputFilePath),
        mimeType: MimeType.PDF,
      });

      // Parse page ranges
      const pageRanges = parsePageRanges(pageRangesStr);

      // Create rotation parameters
      const params = new RotatePagesParams();
      switch (angleSetting.toLowerCase()) {
        case "90":
          params.setAngleToRotatePagesBy(Angle._90, pageRanges);
          break;
        case "180":
          params.setAngleToRotatePagesBy(Angle._180, pageRanges);
          break;
        case "270":
          params.setAngleToRotatePagesBy(Angle._270, pageRanges);
          break;
        default:
          params.setAngleToRotatePagesBy(Angle._90, pageRanges);
      }

      // Create and submit job
      const job = new RotatePagesJob({ inputAsset, params });
      const pollingURL = await pdfServices.submit({ job });
      const pdfServicesResponse = await pdfServices.getJobResult({
        pollingURL,
        resultType: RotatePagesResult,
      });

      // Get result asset
      const resultAsset = pdfServicesResponse.result.asset;
      const streamAsset = await pdfServices.getContent({ asset: resultAsset });

      // Save rotated PDF
      outputFilePath = createOutputFilePath("pdf");
      const writeStream = fs.createWriteStream(outputFilePath);
      streamAsset.readStream.pipe(writeStream);

      // Wait for write completion
      await new Promise((resolve) => writeStream.on("finish", resolve));

      console.log(`Saved rotated PDF at ${outputFilePath}`);
      const downloadUrl = `${req.protocol}s://${req.get(
        "host"
      )}/${outputFilePath}`;

      // Save to database
      const pdfFileRecord = await fileModel.create({
        fileType: "pdf",
        fileUrl: downloadUrl,
        userId: clientId,
        action: `rotated PDF pages (angle: ${angleSetting}, pages: ${pageRangesStr})`,
        fileName: `${req.file.originalname.replace(".pdf", "_rotated.pdf")}`,
        icon: "pdf_rotate",
        metadata: {
          originalFileName: req.file.originalname,
          conversionDate: new Date(),
          angle: angleSetting,
          pageRanges: pageRangesStr,
        },
      });

      res.status(200).json({
        message:
          "PDF rotated successfully. Use the link to download the rotated file.",
        options: {
          angle: angleSetting,
          pageRanges: pageRangesStr,
        },
        file: {
          fileId: pdfFileRecord._id,
          downloadUrl: downloadUrl,
          fileName: `${req.file.originalname.replace(".pdf", "_rotated.pdf")}`,
        },
      });
    } catch (err) {
      console.error("Error rotating PDF:", err);
      res.status(400).json({
        error: `Failed to rotate PDF: ${err.message}`,
      });
    }
  });
};
