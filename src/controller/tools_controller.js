// const fs = require("fs");
// const path = require("path");
// const cloudmersiveConvertApiClient = require("cloudmersive-convert-api-client");
// const axios = require("axios");

// // Cloudmersive API setup
// const defaultClient = cloudmersiveConvertApiClient.ApiClient.instance;
// let Apikey = defaultClient.authentications["Apikey"];
// Apikey.apiKey = "ae24f9b8-2577-4ffd-a90d-17559cacec49"; // 🔑 Replace with your key

// const apiInstance = new cloudmersiveConvertApiClient.ConvertDocumentApi();
// const downloadDir = path.join(__dirname, "downloads");

// // Ensure the directory exists. This is crucial.
// if (!fs.existsSync(downloadDir)) {
//   fs.mkdirSync(downloadDir);
// }
// exports.PdfToWord = async (req, res) => {
//   // console.log(req.file.path);
//   try {
//     const filepath = req.file.path;

//     // 📥 Read the file into a buffer
//     const inputFile = fs.readFileSync(filepath);

//     var callback = function (error, data, response) {
//       // After the API call, clean up the temporary file
//       fs.unlink(filepath, (err) => {
//         if (err) console.error("Error deleting file:", err);
//       });

//       if (error) {
//         console.error("Cloudmersive API Error:", error.response.text);
//         return res.status(400).json("error converting file");
//       } else {
//         const outputFilename = `converted-${Date.now()}.docx`;
//         const outputPath = path.join(__dirname, "downloads", outputFilename);

//         fs.writeFile(outputPath, data, (err) => {
//           if (err) {
//             console.error("Error writing file:", err);
//             return res.status(500).json("Error saving converted file.");
//           }
//           // Proceed to the next step here
//         });
//         res.download(outputPath, (err) => {
//           if (err) {
//             console.error("Error sending file to client:", err);
//             // Handle case where client disconnects before download finishes
//           }
//           // 3. Clean up the converted file after it's sent
//           fs.unlink(outputPath, (unlinkErr) => {
//             if (unlinkErr)
//               console.error("Error deleting converted file:", unlinkErr);
//           });
//         });
//         console.log("API called successfully. Returned data: " + outputPath);
//         return res.status(200).json("file converted successfully"); // The `data` variable is the file stream, not a string.
//       }
//     };

//     // ⬆️ Pass the buffer (file content) directly to the API method
//     apiInstance.convertDocumentPdfToDocx(inputFile, callback);
//   } catch (error) {
//     console.log(error);
//     res.status(400).json("error");
//   }
// };

// // exports.PdfToWord = async(req, res) => {
// //     try {
// //         const pdfPath = req.file.path; // Path to the uploaded PDF file
// //         const pdfName = `${Date.now()}-${req.file.originalname}`;
// //         const outPath = path.join(__dirname, "converted", pdfName); // Output path for the converted Word file

// //         const response = await axios.post(
// //           "https://api.cloudmersive.com/convert/pdf/to/docx",
// //           fs.createReadStream(pdfPath),
// //           {
// //             headers: {
// //               "Content-Type": "application/pdf",
// //               Apikey: "ae24f9b8-2577-4ffd-a90d-17559cacec49",
// //             },
// //             responseType: "arraybuffer",
// //           }
// //         );

// //         console.log(response.data)
// //         fs.writeFileSync(outPath, response.data); // Save the converted file
// //         res.status(200).json({message:"Conversion successful", file: `/download/${pdfName}`});
// //         // Ensure the converted directory exists

// //         // Unique name for the PDF file
// //         // console.log(req);
// //         // res.status(200).json('success');
// //         // return;
// //     // const inputFile = fs.createReadStream(req.file.path);

// //     // apiInstance.convertDocumentPdfToDocx(inputFile, (error, data) => {
// //     //   // Delete temp upload immediately
// //     //   fs.unlinkSync(req.file.path);

// //     //   if (error) {
// //     //     console.error(error);
// //     //     return res.status(500).send("Conversion failed");
// //     //   }

// //     //   // Save converted Word file
// //     //   const outputDir = path.join(__dirname, "converted");
// //     //   if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

// //     //   const outputPath = path.join(outputDir, `converted-${Date.now()}.docx`);
// //     //   fs.writeFileSync(outputPath, data);

// //     //   console.log(`✅ File saved at ${outputPath}`);

// //     //   // Schedule deletion in 1 hour (3600000 ms)
// //     //   setTimeout(() => {
// //     //     if (fs.existsSync(outputPath)) {
// //     //       fs.unlinkSync(outputPath);
// //     //       console.log(`🗑️ Deleted file: ${outputPath}`);
// //     //     }
// //     //   }, 3600000);

// //     //   // Respond with download link
// //     //   res.json({
// //     //     message: "Conversion successful",
// //     //     file: `/download/${path.basename(outputPath)}`,
// //     //   });
// //     // });
// //   } catch (err) {
// //     console.error(err);
// //     res.status(500).send("Error processing file");
// //   }
// // };

// // Route to serve converted files
// exports.download = async (req, res) => {
//   const filePath = path.join(__dirname, "converted", req.params.filename);

//   if (fs.existsSync(filePath)) {
//     res.download(filePath);
//   } else {
//     res.status(404).send("File not found or expired");
//   }
// };

const fileModel = require("../models/file_model");
const fs = require("fs");
const path = require("path");
const cloudmersiveConvertApiClient = require("cloudmersive-convert-api-client");
const cron = require("node-cron");
const ILovePDFApi = require("@ilovepdf/ilovepdf-nodejs");
const mongoose = require("mongoose");
const { ObjectId } = mongoose.Types;
// import CloudConvert from "cloudconvert";
// const cloudConvert = new CloudConvert("api_key");

// const iloveapi = require('iloveapi'); // Adjust the import based on your setup

// API setup
const defaultClient = cloudmersiveConvertApiClient.ApiClient.instance;
let Apikey = defaultClient.authentications["Apikey"];
Apikey.apiKey = "ae24f9b8-2577-4ffd-a90d-17559cacec49";

const apiInstance = new cloudmersiveConvertApiClient.ConvertDocumentApi();

// Define the downloads directory path relative to the current file
const downloadDir = path.join("downloads");

// Ensure the directory exists. This is crucial.
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir);
}

exports.PdfToWord = async (req, res) => {
  // Check if a file was uploaded
  if (!req.file) {
    return res.status(400).json({ message: "No file was uploaded." });
  }

  try {
    const inputFilePath = req.file.path;
    // Read the file content from the temporary path
    const inputFile = fs.readFileSync(inputFilePath);

    // Define the callback function for the API call
    var callback = function (error, data, response) {
      // First, delete the temporary uploaded file to clean up
      fs.unlink(inputFilePath, (err) => {
        if (err) console.error("Error deleting temp file:", err);
      });

      if (error) {
        console.error("Cloudmersive API Error:", error.response.text);
        return res.status(400).json({
          message: "Error converting file.",
          error: error.response.text,
        });
      }

      // Generate a unique filename and path for the converted file
      const outputFilename = `converted-${Date.now()}.docx`;
      const outputPath = path.join(downloadDir, outputFilename);

      // Write the converted file data to disk
      fs.writeFile(outputPath, data, async (err) => {
        if (err) {
          console.error("Error saving converted file:", err);
          return res
            .status(500)
            .json({ message: "Error saving converted file." });
        }
        const downloadUrl = `${req.protocol}://${req.get(
          "host"
        )}/downloads/${outputFilename}`;

        const newFile = await fileModel.create({
          fileType: "pdf",
          fileUrl: downloadUrl,
        });
        console.log(newFile, "newFile_id");
        res.status(200).json({
          message: "File converted successfully. Use the link to download.",
          fileId: newFile._id,
        });
      });
    };

    // Call the Cloudmersive API
    apiInstance.convertDocumentPdfToDocx(inputFile, callback);
  } catch (error) {
    // Catches errors with file read (e.g., file not found)
    console.error("Internal Server Error:", error);
    res.status(400).json({ message: "An internal server error occurred." });
  }
};

exports.WordToPdf = async (req, res) => {
  // Check if a file was uploaded
  if (!req.file) {
    return res.status(400).json({ message: "No file was uploaded." });
  }

  try {
    const inputFilePath = req.file.path;
    // Read the file content from the temporary path
    const inputFile = fs.readFileSync(inputFilePath);

    // Define the callback function for the API call
    var callback = function (error, data, response) {
      // First, delete the temporary uploaded file to clean up
      fs.unlink(inputFilePath, (err) => {
        if (err) console.error("Error deleting temp file:", err);
      });

      if (error) {
        console.error("Cloudmersive API Error:", error.response.text);
        return res.status(400).json({
          message: "Error converting file.",
          error: error.response.text,
        });
      }

      // Generate a unique filename and path for the converted file
      const outputFilename = `converted-${Date.now()}.pdf`;
      const outputPath = path.join(downloadDir, outputFilename);

      // Write the converted file data to disk
      fs.writeFile(outputPath, data, async (err) => {
        if (err) {
          console.error("Error saving converted file:", err);
          return res
            .status(500)
            .json({ message: "Error saving converted file." });
        }
        const downloadUrl = `${req.protocol}://${req.get(
          "host"
        )}/downloads/${outputFilename}`;

        const newFile = await fileModel.create({
          fileType: "docx",
          fileUrl: downloadUrl,
        });
        console.log(newFile, "newFile_id");
        res.status(200).json({
          message: "File converted successfully. Use the link to download.",
          fileId: newFile._id,
        });
      });
    };

    // Call the Cloudmersive API
    apiInstance.convertDocumentDocxToPdf(inputFile, callback);
  } catch (error) {
    // Catches errors with file read (e.g., file not found)
    console.error("Internal Server Error:", error);
    res.status(400).json({ message: "An internal server error occurred." });
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
