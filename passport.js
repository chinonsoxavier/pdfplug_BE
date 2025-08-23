const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("./src/models/user_model"); // Adjust the path to your User model
const userServices = require("./src/services/user_services");
const CryptoJS = require("crypto-js");
const GitHubStrategy = require("passport-github2").Strategy;
passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (_id, done) => {
  console.log(_id, "id");
  try {
    const user = await User.findById(_id);
    if (!user) {
      return done(null, false, {
        message: "User not found",
      });
    }

    const { password, ...info } = user._doc; // No need for optional chaining here
    done(null, info);
  } catch (err) {
    done(err, null);
  }
});

passport.use(
  new LocalStrategy(
    {
      usernameField: "email",
    },
    async (email, password, done) => {
      console.log("started");
      const userEmail = email;
      const userPassword = password;
      const existingUser = await userServices.getUserByEmail(userEmail);
      if (existingUser == null || existingUser.$isEmpty() || !existingUser.password) {
        console.log(userEmail);
        console.log(userPassword);
        console.log(existingUser, "existing");
        return done(null, false, {
          message: "User not found or uses social login",
        });
      }
      if (!existingUser.isVerified)
        return done(null, false, {
          message:
            "Email not verified,Check your email for verification link!",
        });

      try {
        const bytes = existingUser
          ? CryptoJS.AES?.decrypt(
              existingUser?.password,
              process.env.CRYPTO_JS_SECRET_KEY
            )
          : null;
        const originalPassword = bytes?.toString(CryptoJS.enc.Utf8);
        if (originalPassword !== userPassword) {
          return done(null, false, { message: "Incorrect password" });
        }
        const { password, ...info } = existingUser._doc;
        const userSession = { ...info };
        return done(null, userSession);
      } catch (err) {
        return done(err);
      }
    }
  )
);

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL ||
        "http://localhost:5000/api/v1/auth/google/callback",
      scope: ["profile", "email"],
    },
    (accessToken, refreshToken, profile, done) => {
      // console.log(accessToken, refreshToken);
      console.log(profile, "progile");
      User.findOne({ email: profile.emails[0].value })
        .then((existingUser) => {
          if (existingUser) {
            if (existingUser.password) {
              return done(null, existingUser);
            } else {
              existingUser.profileId = profile.id;
              existingUser
                .save()
                .then(() => done(null, existingUser))
                .catch((err) => done(err));
              return;
            }
          }
          const newUser = new User({
            googleId: profile.id,
            userName: profile.displayName,
            email: profile.emails[0].value,
            profileId: profile.id,
            isVerified: true,
            provider: "google",
            profilePic: profile?.photos[0]?.value,
          });
          newUser
            .save()
            .then(() => done(null, newUser))
            .catch((err) => done(err));
        })
        .catch((err) => done(err));
    }
  )
);

passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL:
        process.env.GITHUB_CALLBACK_URL ||
        "http://localhost:4000/api/v1/auth/github/callback",
    },
    function (profile, done) {
      User.findOne({ profileId: profile.id })
        .then((existingUser) => {
          if (existingUser) {
            User.findOneAndUpdate(
              { _id: existingUser?._id },
              { isVerified: true }
            );
            if (existingUser.password) {
              return done(null, existingUser);
            } else {
              existingUser.profileId = profile.id;
              existingUser
                .save()
                .then(() => done(null, existingUser))
                .catch((err) => done(err));
              return;
            }
          }
          console.log(profile, "login");
          const newUser = new User({
            githubId: profile.id,
            userName: profile.username,
            email: profile?.emails,
            profileId: profile.id,
            profilePic: profile?.photos[0]?.value,
            provider: profile.provider,
            isVerified: true,
            // Correctly access the email
            // Add other fields as necessary
          });
          newUser
            .save()
            .then(() => done(null, newUser))
            .catch((err) => done(err));
        })
        .catch((err) => done(err));
    }
  )
);

module.exports = passport;
