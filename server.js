const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;
const SECRET_KEY = process.env.JWT_SECRET;

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Database connected"))
  .catch((err) => {
    console.error("db error:", err.message);
    process.exit(1);
  });

app.use(cors({
  origin: ["https://ironup.netlify.app", "http://10.5.0.2:5173"],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Backend is running.");
});

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});

const User = mongoose.model("User", userSchema);

const groupSchema = new mongoose.Schema({
  groupId: { type: String, required: true, unique: true },
  createdAt: { type: String, required: true },
  exercise: { type: String, required: true, enum: ["Push Ups", "Pull Ups", "Dips"] },
  days: { type: Number, required: true, min: 15, max: 90 },
  members: { type: Map, of: Number }
});
const Group = mongoose.model("Group", groupSchema);

app.post("/create-group", async (req, res) => {
    try {
        const { username, exercise, days } = req.body;

        if (!username || !exercise || !days) {
            return res.status(400).json({ message: "Tutti i campi sono obbligatori" });
        }

        const groupId = uuidv4().slice(0, 12);
        const createdAt = new Date().toLocaleDateString("it-IT");

        const newGroup = new Group({
            groupId,
            createdAt,
            exercise,
            days,
            members: { [username]: 0 }
        });

        await newGroup.save();
        res.status(201).json({ message: "Gruppo creato con successo", groupId });
    } catch (error) {
        console.error("Errore nella creazione del gruppo:", error);
        res.status(500).json({ message: "Errore del server", error });
    }
});

app.post("/join-group", async (req, res) => {
  try {
      const { groupId, username } = req.body;

      if (!groupId || !username) {
          return res.status(400).json({ message: "ID gruppo e username richiesti" });
      }

      const group = await Group.findOne({ groupId });
      if (!group) return res.status(404).json({ message: "Gruppo non trovato" });

      if (group.members.has(username)) {
          return res.status(400).json({ message: "Sei già in questo gruppo!" });
      }

      group.members.set(username, 0);
      await group.save();

      res.status(200).json({ message: "Sei entrato nel gruppo con successo!" });
  } catch (error) {
      console.error("Errore nell'unione al gruppo:", error);
      res.status(500).json({ message: "Errore del server", error });
  }
});


app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
