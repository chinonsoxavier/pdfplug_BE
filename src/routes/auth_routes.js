const passport = require("passport");
const { verify } = require("../services/jwt_services");
const authController = require("../controller/auth_controller");
const router = require("express").Router();
const jwt = require("jsonwebtoken");
router.post("/register", authController.createUser);
router.put("/verify/:token", verify, authController.verifyUser);
router.post(
  "/refresh-verification-token/:token",
  authController.RefreshVerificationToken
);
router.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    const guestId = req.session?.guestId;
    if (err) {
      return next(err); // Handle errors
    }
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: info.message || "Login failed" });
    }

    req.logIn(user, (err) => {
      if (err) {
        return next(err); // Handle login errors
      }

      MergeCart(req, guestId);
      res
        .status(200)
        .json({ success: true, message: "Login successful", user });
    });
  })(req, res, next);
});

router.get("/login/failure", (req, res) => {
  res.status(401).json({ success: false, message: "Login Failed" });
});
router.post("/reset-password", authController.ResetPasswordToken);
router.put(
  "/change-password/:token",
  (req, res, next) => {
    jwt.verify(req.params.token, process.env.JWTSECRET_KEY, (err, user) => {
      console.log("veryfying");
      if (err?.name == "TokenExpiredError") {
        return res.status(400).json("Token is expired");
      }
      if (err) {
        return res.status(400).json("Token is not valid");
      }
      next();
    });
  },
  authController.ChangeUserPassword
);
router.get("/load-user", authController.GetUser);
router.get("/login/failure", (req, res) => {
  res.send("Failed to login");
});
router.get("/login/success", authController.LoginSuccess);
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);
router.get(
  "/google/callback",
  passport.authenticate("google", {
    successRedirect: process.env.CLIENT_URL || "http://localhost:5173",
    failureRedirect: "/login",
  })
);

router.get(
  "/github",

  passport.authenticate("github", { scope: ["profile", "email"] })
);
router.get(
  "/github/callback",
  passport.authenticate("github", {
    successRedirect: process.env.CLIENT_URL || "http://localhost:5173",
    failureRedirect: "/login",
  })
);

router.get("/logout", (req, res, next) => {
  try {
    req.logout((err) => {
      if (err) {
        return next(err);
      }
      req.session.destroy((err) => {
        if (err) {
          return next(err);
        }
        console.log(req.session);
        // res.redirect("http://localhost:5173");
      });
    });
    res.status(200).json("Logged out");
  } catch (error) {
    res.status(400).json(error);
    console.log(error);
  }
});

// }

module.exports = router;
