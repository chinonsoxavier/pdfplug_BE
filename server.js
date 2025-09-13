require("dotenv").config();
const express = require("express");
const app = express();
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const MongoStore = require("connect-mongo");
const session = require("express-session");
const multer = require("multer");
const passport = require("passport");
require("./passport");

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
      sameSite: "none",
      httpOnly: false,
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

const allowedOrigins = [
  process.env.CLIENT_URL_DEV,
  process.env.CLIENT_URL_PRO,
].filter(Boolean);

dotenv.config();
mongoose
  .connect(process.env.MONGODB_URI, {})
  .then(() => console.log("Db connection Successfully"))
  .catch((err) => console.log(err));
app.use(express.json());

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: process.env.CLIENT_URL_DEV,
    credentials: true,
  })
);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", process.env.CLIENT_URL_DEV);
  res.header("Access-Control-Allow-Credentials", true);
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  next();
});

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

const toolsRoutes = require("./src/routes/tools_routes.js");
const authRoutes = require("./src/routes/auth_routes.js");
const userRoutes = require("./src/routes/user_routes.js");
const baseRoute = "/api/v1/";
app.use("/uploads", express.static("uploads"));
app.use("/downloads", express.static("downloads"));
app.get("/", (req, res) => {
  res.send("API is running...");
});
app.use(baseRoute + "auth", authRoutes);
app.use(baseRoute + "user", userRoutes);
app.use(baseRoute + "tools", toolsRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
