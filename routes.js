const express = require("express");
const router = express.Router();
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const connection = require("./db-connection");

// Set up multer for file upload
const upload = multer({ dest: "uploads/" });

const readline = require("readline");

function parseMantisCsv(filePath) {
  return new Promise((resolve, reject) => {
    const outputRows = [];

    const input = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input });

    const tempPath = `${filePath}-cleaned.csv`;
    const tempStream = fs.createWriteStream(tempPath);

    let lineCount = 0;
    rl.on("line", (line) => {
      if (lineCount >= 5) tempStream.write(line + "\n");
      lineCount++;
    });

    rl.on("close", () => {
      tempStream.end();

      // Now re-parse just the valid part
      fs.createReadStream(tempPath)
        .pipe(csv())
        .on("data", (row) => {
          if (row["ID"] && row["Score"]) {
            outputRows.push(row);
          }
        })
        .on("end", () => {
          fs.unlink(tempPath, () => {}); // cleanup temp
          resolve(outputRows);
        })
        .on("error", reject);
    });
  });
}

// =======================
// ROUTES
// =======================

// GET all users
router.get("/users", (req, res) => {
  connection.query("SELECT * FROM users", (err, results) => {
    if (err) {
      return res.status(500).send(err);
    }
    res.json(results);
  });
});

// POST a new user
router.post("/users", (req, res) => {
  const user = req.body;
  connection.query("INSERT INTO users SET ?", user, (err, results) => {
    if (err) {
      return res.status(500).send(err);
    }
    res.status(201).send(results);
  });
});

// POST route to upload two CSV files (heart rate + mantis shots)
router.post("/upload", upload.single("mantisFile"), async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: "MANTIS CSV file is required." });
  }

  try {
    const sessions = await parseMantisCsv(file.path);
    if (sessions.length === 0) {
      return res.status(400).json({ error: "No valid session data found." });
    }

    // Flush existing sessions
    await connection.promise().query("SET FOREIGN_KEY_CHECKS = 0");
    await connection.promise().query("TRUNCATE TABLE mantis_data_sessions");
    await connection.promise().query("SET FOREIGN_KEY_CHECKS = 1");

    // Insert all sessions
    for (const row of sessions) {
      const newSession = {
        session_id: parseInt(row["ID"]),
        user_id: 1, // TEMP
        total_shots: parseInt(row["Shot Count"]) || 0,
        avg_score: parseFloat(row["Score"]) || 0,
        time_started: new Date(row["Date"]),  // <-- this works fine with UTC string!
        session_length: new Date(1000 * 60 * 5), // Placeholder: 5 minutes
      };
      

      await connection.promise().query("INSERT INTO mantis_data_sessions SET ?", newSession);
    }

    fs.unlink(file.path, () => {}); // Clean up temp file

    res.json({
      message: `Uploaded ${sessions.length} MANTIS session(s) successfully.`,
    });

  } catch (err) {
    console.error("CSV processing error:", err);
    res.status(500).json({ error: "Failed to process MANTIS session CSV." });
  }
});


module.exports = router;