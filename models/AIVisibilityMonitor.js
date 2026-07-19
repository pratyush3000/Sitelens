import mongoose from "mongoose";

const aiVisibilityMonitorSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  brandName: { type: String, required: true },
  keyword: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  aliases: { type: [String], default: [] }, // e.g. ["Prime Video", "Amazon Prime Video"]
  lastCheckedAt: { type: Date, default: null },
  alertsEnabled: { type: Boolean, default: true },
  checkFrequency: { type: String, enum: ["6h", "12h", "daily", "weekly", "monthly"], default: "daily" },
  preferredTime: { type: String, default: "09:00" }, // HH:mm format, e.g., "09:00" for 9 AM
  preferredDay: { type: String, enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], default: "Monday" }, // for weekly
  lastRunHour: { type: Number, default: -1 }, // track which hour the check last ran to avoid duplicates
  nextCheckAt: { type: Date, default: Date.now },
  skipNextCheck: { type: Boolean, default: false }, // user can cancel next scheduled check
  lastRunStatus: { type: String, default: "pending" }, // "pending", "success", "failed"
  lastRunError: { type: String, default: null }, // error message if check failed
  lastModelUsed: { type: String, default: null }, // which model ran the last check (e.g., "Gemini", "Llama", "Llama (auto-router)")
  timezone: { type: String, default: "UTC" }, // user's timezone for scheduling (e.g., "Asia/Kolkata", "America/New_York")
  createdAt: { type: Date, default: Date.now }
});

// One brand+keyword pair per user
aiVisibilityMonitorSchema.index({ userId: 1, brandName: 1, keyword: 1 }, { unique: true });

export default mongoose.model("AIVisibilityMonitor", aiVisibilityMonitorSchema);