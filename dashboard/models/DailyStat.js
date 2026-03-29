import mongoose from "mongoose";

const DailyStatSchema = new mongoose.Schema({
  website: String,
  date: String,
  totalChecks: Number,
  successes: Number,
  failures: Number,
  downtimeEvents: Number,
  totalDowntime: Number,
  avgResponseTime: Number,
  lastRating: String
});

export default mongoose.model("DailyStat", DailyStatSchema);
