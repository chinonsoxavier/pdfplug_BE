const router = require("express").Router();
const userController = require("../controller/user_controller");
const { upload } = require("../utils/multer");

router.put("/update-user", upload.single("file"), userController.UpdateUserDetails);
router.put("/update-user-password",userController.ChangeUserPassword);
router.get("/get-user/:id",userController.GetUser)
module.exports = router;