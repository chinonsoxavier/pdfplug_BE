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

const downloadDir = path.join("downloads"); // Ensure this path is correct

if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir);
}

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

// exports.mergePdfs = async (req, res) => {
//     console.log(req.files);
//   // Ensure that 'req.files' contains the uploaded files
//   if (!req.files || req.files.length < 2) {
//     return res
//       .status(400)
//       .json({ error: "Please upload at least two PDF files to merge." });
//   }

//   // Use the getClientIdAndProcess function to ensure a client ID is available
//   getClientIdAndProcess(req, res, async (clientId) => {
//     let readStreams = []; // To keep track of all read streams for cleanup

//     try {
//       const credentials = new ServicePrincipalCredentials({
//         clientId: process.env.PDF_SERVICES_CLIENT_ID,
//         clientSecret: process.env.PDF_SERVICES_CLIENT_SECRET,
//       });

//       const pdfServices = new PDFServices({
//         credentials,
//         timeout: 80000, // Increased timeout for potentially larger merge jobs
//       });

//       const inputAssets = [];
//       for (const file of req.files) {
//         if (file.mimetype !== "application/pdf") {
//           return res
//             .status(400)
//             .json({ error: `File '${file.originalname}' is not a PDF.` });
//         }
//         const readStream = fs.createReadStream(file.path);
//         readStreams.push(readStream); // Add to cleanup list
//         const inputAsset = await pdfServices.upload({
//           readStream,
//           mimeType: MimeType.PDF,
//         });
//         inputAssets.push(inputAsset);
//       }
//         console.log(inputAssets,"input assests")

//       // Create a new CombinePDFJob with the uploaded input assets
//     //   const job = new CombinePDFJob({ inputAssets });

//       // Helper function to submit job with retry logic
//       async function submitJobWithRetry(job, retries = 3) {
//         for (let attempt = 0; attempt < retries; attempt++) {
//           try {
//             const pollingURL = await pdfServices.submit({ job });
//             return pollingURL;
//           } catch (err) {
//             console.warn(
//               `Attempt ${attempt + 1} failed for job submission:`,
//               err.message
//             );
//             if (attempt === retries - 1) throw err; // Rethrow if it's the last attempt
//           }
//         }
//       }

//       const pollingURL = await submitJobWithRetry(job);
//       const pdfServicesResponse = await pdfServices.getJobResult({
//         pollingURL,
//         resultType: CombinePDFResult, // Use CombinePDFResult for merging
//       });

//       const resultAsset = pdfServicesResponse.result.asset;
//       const streamAsset = await pdfServices.getContent({ asset: resultAsset });

//       const outputFilePath = createOutputFilePath("pdf"); // Merged output is a PDF
//       const outputStream = fs.createWriteStream(outputFilePath);
//       streamAsset.readStream.pipe(outputStream);

//       const downloadUrl = `${req.protocol}s://${req.get(
//         "host"
//       )}/${outputFilePath}`;

//       const newFile = await fileModel.create({
//         fileType: "application/pdf", // Resulting file type is PDF
//         fileUrl: downloadUrl,
//         userId: clientId,
//         action: "merged Pdf files",
//         fileName: `merged_document_${Date.now()}.pdf`, // Generate a generic name
//         icon: "merge_pdf",
//       });

//       res.status(200).json({
//         message: "PDF files merged successfully. Use the link to download.",
//         fileId: newFile._id,
//       });
//     } catch (err) {
//       console.error("Exception encountered while merging PDFs:", err);
//       let errorMessage = "Failed to merge PDF files.";
//       if (
//         err instanceof SDKError ||
//         err instanceof ServiceUsageError ||
//         err instanceof ServiceApiError
//       ) {
//         errorMessage = `Adobe PDF Services SDK Error: ${err.message}`;
//       }
//       res.status(400).json({ error: errorMessage });
//     } finally {
//       // Clean up all read streams
//       readStreams.forEach((stream) => stream?.destroy());
//       // Optionally clean up uploaded temporary files if multer doesn't handle it automatically
//       // For req.files, multer typically deletes temp files by default, but confirm your multer config.
//     }
//   });
// };

exports.mergePdfs = async (req, res) => {
  if (!req.files || req.files.length < 2) {
    return res
      .status(400)
      .json({ error: "Please upload at least two PDF files to merge." });
  }

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

      const downloadUrl = `${req.protocol}://${req.get(
        "host"
      )}/${outputFilePath}`;

      // 8. Save file record in DB
      const newFile = new fileModel({
        fileType: "application/pdf",
        fileUrl: downloadUrl,
        userId: clientId,
        action: "Merged PDF files",
        fileName: `merged_document_${Date.now()}.pdf`,
        icon: "merge_pdf",
      }).save();

      res.status(200).json({
        message: "PDFs merged successfully",
        fileId: newFile._id,
        downloadUrl,
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
      readStreams.forEach((s) => s?.destroy());
    }
  });
};
