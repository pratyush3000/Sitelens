import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving
userSchema.pre("save", async function() {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

// Cascade delete helper function
async function cascadeDeleteUser(userId) {
  try {
    const Site = mongoose.model("Site");
    const Log = mongoose.model("Log");
    const AIVisibilityLog = mongoose.model("AIVisibilityLog");
    const AIVisibilityMonitor = mongoose.model("AIVisibilityMonitor");

    const results = await Promise.all([
      Site.deleteMany({ userId }),
      Log.deleteMany({ userId }),
      AIVisibilityLog.deleteMany({ userId }),
      AIVisibilityMonitor.deleteMany({ userId })
    ]);

    const totalDeleted = results.reduce((sum, r) => sum + (r.deletedCount || 0), 0);
    console.log(`✅ Cascade deleted ${totalDeleted} records for user ${userId}`);
  } catch (err) {
    console.error(`❌ Cascade delete failed for user ${userId}:`, err.message);
  }
}

// Cascade delete for deleteOne() (document.deleteOne)
userSchema.post("deleteOne", { document: true }, async function() {
  await cascadeDeleteUser(this._id);
});

// Cascade delete for findByIdAndDelete()
userSchema.post("findByIdAndDelete", async function(doc) {
  if (doc) await cascadeDeleteUser(doc._id);
});

// Cascade delete for findOneAndDelete()
userSchema.post("findOneAndDelete", async function(doc) {
  if (doc) await cascadeDeleteUser(doc._id);
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model("User", userSchema);

