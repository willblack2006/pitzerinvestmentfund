const EDIT_PASSWORD = process.env.EDIT_PASSWORD || "pitzerfund";

function requireAuth(req, res, next) {
  const supplied = req.get("x-edit-password") || "";
  if (supplied !== EDIT_PASSWORD) {
    return res.status(401).json({ error: "Invalid or missing edit password." });
  }
  next();
}

module.exports = { requireAuth, EDIT_PASSWORD };
