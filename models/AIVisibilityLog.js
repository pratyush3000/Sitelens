import mongoose from "mongoose";
const aiVisibilityLogSchema = new mongoose.Schema({ 
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  brandName: { type: String, required: true },
  keyword: { type: String, required: true },
  status: { type: String, enum: ["VISIBLE", "HIDDEN"], required: true },
  rank: { type: Number, default: null },
  totalRecommendations: { type: Number, default: 5 },
 mentionSnippet: { type: String, default: "Not mentioned" },
  matchedAs: { type: String, default: null }, // which name/alias actually matched
  checkedAt: { type: Date, default: Date.now }

});

// Index for fast queries per user
aiVisibilityLogSchema.index({ userId: 1, checkedAt: -1 });
aiVisibilityLogSchema.index({ userId: 1, brandName: 1, keyword: 1 });

export default mongoose.model("AIVisibilityLog", aiVisibilityLogSchema);