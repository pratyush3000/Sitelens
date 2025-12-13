import mongoose from "mongoose";

const siteSchema = new mongoose.Schema({
  website: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  addedAt: { type: Date, default: Date.now }
});

// Compound index: same website can exist for different users
siteSchema.index({ userId: 1, website: 1 }, { unique: true });

export default mongoose.model("Site", siteSchema);
