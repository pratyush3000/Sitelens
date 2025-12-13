import mongoose from "mongoose";

const logSchema = new mongoose.Schema({
  website: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  messagetype: { type: String, required: true }, // up, down, warn
  success: { type: Boolean, required: true },
  statusCode: { type: Number },
  responseTime: { type: Number },
  rating: { type: String },
  sslExpiryDays: { type: Number },
  error: { type: String },
  timestamp: { type: Date, default: Date.now }
});

// Index for efficient queries
logSchema.index({ userId: 1, website: 1, timestamp: -1 });

const Log = mongoose.model("Log", logSchema);

export default Log;
