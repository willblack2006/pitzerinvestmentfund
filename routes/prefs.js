const express = require("express");
const { requireSignedIn } = require("../middleware/auth");
const { getPrefs, setPrefs } = require("../lib/prefs");

const router = express.Router();

router.get("/prefs", requireSignedIn, (req, res) => res.json(getPrefs(req.member.id)));

// Merge: only the keys sent change; null clears a key back to the default.
router.put("/prefs", requireSignedIn, (req, res) => {
  try {
    res.json(setPrefs(req.member.id, req.body || {}));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
