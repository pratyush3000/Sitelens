import mongoose from "mongoose";

const logSchema = new mongoose.Schema({
  website: { type: String, required: true },
  messagetype: { type: String, required: true }, // up, down, warn
  success: { type: Boolean, required: true },
  statusCode: { type: Number },
  responseTime: { type: Number },
  rating: { type: String },
  sslExpiryDays: { type: Number },
  error: { type: String },
  timestamp: { type: Date, default: Date.now }
});

const Log = mongoose.model("Log", logSchema);

export default Log;
