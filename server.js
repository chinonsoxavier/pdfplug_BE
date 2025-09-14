require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const multer = require("multer");
const passport = require("passport");
require("./passport");

const app = express();

// Define allowed origins
const allowedOrigins = [
  process.env.CLIENT_URL_DEV, // e.g., http://localhost:3000
  process.env.CLIENT_URL_PRO, // e.g., https://pdf-converter-tool-nest.vercel.app
].filter(Boolean); // Remove undefined or null values
app.use(
  cors({
    origin: process.env.CLIENT_URL_PRO,
    credentials: true,
  })
);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "https://pdf-converter-tool-nest.vercel.app");
  // Replace with your frontend's origin
  res.header("Access-Control-Allow-Credentials", true);
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept" // Corrected line
  );
  next();
});
// Session configuration
app.use(
  session({
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "PRODUCTION",
      sameSite: process.env.NODE_ENV === "PRODUCTION" ? "none" : "lax", // Use 'none' for cross-origin in production
      httpOnly: true, // Secure cookies
    },
  })
);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// MongoDB connection
mongoose
  .connect(process.env.MONGODB_URI, {})
  .then(() => console.log("Db connection successful"))
  .catch((err) => console.error("Db connection error:", err));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));
app.use("/downloads", express.static("downloads"));

// Multer error handling
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

// Routes
const baseRoute = "/api/v1/";
app.use(baseRoute + "auth", require("./src/routes/auth_routes.js"));
app.use(baseRoute + "user", require("./src/routes/user_routes.js"));
app.use(baseRoute + "tools", require("./src/routes/tools_routes.js"));

app.get("/", (req, res) => {
  res.send("API is running...");
});

// General error handler
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "An unexpected server error occurred." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
