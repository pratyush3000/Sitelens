import User from "../models/User.js";
import Site from "../models/Site.js";
import Log from "../models/Log.js";
import AIVisibilityLog from "../models/AIVisibilityLog.js";
import AIVisibilityMonitor from "../models/AIVisibilityMonitor.js";

export async function cleanupOrphanedData() {
  try {
    console.log("🧹 Starting orphaned data cleanup...");

    // Get all userIds that exist
    const existingUsers = await User.find({}, { _id: 1 }).lean();
    const validUserIds = new Set(existingUsers.map(u => u._id.toString()));

    // Find and delete orphaned records in each collection
    const cleanups = [
      { name: "Sites", model: Site },
      { name: "Logs", model: Log },
      { name: "AIVisibilityLogs", model: AIVisibilityLog },
      { name: "AIVisibilityMonitors", model: AIVisibilityMonitor }
    ];

    let totalDeleted = 0;

    for (const { name, model } of cleanups) {
      const records = await model.find({}, { userId: 1 }).lean();
      const orphaned = records.filter(r => !validUserIds.has(r.userId.toString()));

      if (orphaned.length > 0) {
        const orphanedIds = orphaned.map(r => r._id);
        const result = await model.deleteMany({ _id: { $in: orphanedIds } });
        console.log(`   ✅ ${name}: Deleted ${result.deletedCount} orphaned records`);
        totalDeleted += result.deletedCount;
      }
    }

    console.log(`✅ Orphan cleanup complete. Deleted ${totalDeleted} total records.`);
  } catch (err) {
    console.error("❌ Orphan cleanup failed:", err.message);
  }
}

export default cleanupOrphanedData;
