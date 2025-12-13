const mysql = require("mysql2/promise");

async function testDb() {
  try {
    const conn = await mysql.createConnection({
      host: "localhost",
      user: "monitor_user",      // your DB user
      password: "password123",   // your DB password
      database: "monitor_db"     // your DB name
    });

    const [rows] = await conn.query("SELECT * FROM users");
    console.log("✅ DB connection successful. Rows:", rows);

    await conn.end();
  } catch (err) {
    console.error("❌ DB connection failed:", err.message);
  }
}

testDb();
