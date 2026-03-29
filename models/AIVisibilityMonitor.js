import mongoose from "mongoose";

const aiVisibilityMonitorSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  brandName: { type: String, required: true },
  keyword: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  aliases: { type: [String], default: [] }, // e.g. ["Prime Video", "Amazon Prime Video"]
  lastCheckedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

// One brand+keyword pair per user
aiVisibilityMonitorSchema.index({ userId: 1, brandName: 1, keyword: 1 }, { unique: true });

export default mongoose.model("AIVisibilityMonitor", aiVisibilityMonitorSchema);