import mongoose from "mongoose";

const siteSchema = new mongoose.Schema({
  website: { type: String, required: true, unique: true },
  addedAt: { type: Date, default: Date.now }
});

export default mongoose.model("Site", siteSchema);
