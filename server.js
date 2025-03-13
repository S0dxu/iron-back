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
  password: { type: String, required: true },
  avatar: { type: String, required: true, default: 'https://i.imgur.com/Mwskb9x.png' },
  coin: { type: Number, default: 0 },
  currentGroup: { type: String, default: null },
  history: { type: Array, default: [] }
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

app.post("/register", async (req, res) => {
  try {
    const { username, email, password, avatar } = req.body;

    if (!username || !email || !password || !avatar) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const userExists = await User.findOne({ $or: [{ username }, { email }] });
    if (userExists) return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, email, password: hashedPassword, avatar });

    await newUser.save();
    res.status(201).json({ message: "Registration successful" });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    const user = await User.findOne(isEmail ? { email: identifier } : { username: identifier });

    if (!user) return res.status(400).json({ message: "User not found" });

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign({ userId: user._id, username: user.username, avatar: user.avatar }, SECRET_KEY, { expiresIn: "7d" });

    res.status(200).json({ message: "Login successful", token, username: user.username });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

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

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: "Utente non trovato" });

    if (user.currentGroup) {
      return res.status(400).json({ message: "Sei già in un gruppo. Abbandonalo prima di unirti a un altro." });
    }

    const group = await Group.findOne({ groupId });
    if (!group) return res.status(404).json({ message: "Gruppo non trovato" });

    group.members.set(username, 0);
    await group.save();

    user.currentGroup = groupId;
    await user.save();

    res.status(200).json({ message: "Sei entrato nel gruppo con successo!", members: Array.from(group.members.keys()) });
  } catch (error) {
    console.error("Errore nell'unione al gruppo:", error);
    res.status(500).json({ message: "Errore del server", error });
  }
});

function convertToDate(dateString) {
  const parts = dateString.split('/');
  return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
}

app.get("/user-group/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: "Utente non trovato" });
    if (!user.currentGroup) {
      return res.status(200).json({ message: "Nessun gruppo trovato", groupId: null });
    }
    const group = await Group.findOne({ groupId: user.currentGroup });
    if (!group) {
      user.currentGroup = null;
      await user.save();
      return res.status(404).json({ message: "Il gruppo non esiste più", groupId: null });
    }

    const groupStartDate = convertToDate(group.createdAt);
    if (isNaN(groupStartDate.getTime())) {
      console.error("Errore: la data di creazione non è valida:", group.createdAt);
      return res.status(400).json({ message: "Data di creazione non valida" });
    }

    const groupDuration = Number(group.days);
    if (isNaN(groupDuration)) {
      console.error("Errore: la durata del gruppo non è valida:", group.days);
      return res.status(400).json({ message: "Durata del gruppo non valida" });
    }

    const groupEndDate = new Date(groupStartDate);
    groupEndDate.setDate(groupEndDate.getDate() + groupDuration);

    const currentDate = new Date();
    const timeLeft = groupEndDate - currentDate;
    const daysLeft = Math.floor(timeLeft / (1000 * 60 * 60 * 24));

    const finalDaysLeft = daysLeft < 0 ? 0 : daysLeft;

    const membersWithAvatar = await Promise.all(
      Array.from(group.members.keys()).map(async (username) => {
        const member = await User.findOne({ username });
        return { username: member.username, avatar: member.avatar, coin: member.coin, history: member.history };
      })
    );

    res.status(200).json({
      groupId: user.currentGroup,
      members: membersWithAvatar,
      exercise: group.exercise,
      daysLeft: finalDaysLeft,
      totals:  group.days,
      history: user.history
    });
  } catch (error) {
    console.error("Errore nel recupero del gruppo:", error);
    res.status(500).json({ message: "Errore del server", error });
  }
});



app.post("/leave-group", async (req, res) => {
  try {
      const { username } = req.body;

      if (!username) {
          return res.status(400).json({ message: "Username richiesto" });
      }

      const user = await User.findOne({ username });
      if (!user || !user.currentGroup) {
          return res.status(400).json({ message: "Non sei in nessun gruppo" });
      }

      const group = await Group.findOne({ groupId: user.currentGroup });
      if (!group) {
          user.currentGroup = null;
          await user.save();
          return res.status(404).json({ message: "Gruppo non trovato, ma stato utente aggiornato" });
      }

      group.members.delete(username);
      await group.save();

      user.currentGroup = null;
      await user.save();

      res.status(200).json({ message: "Sei uscito dal gruppo con successo" });
  } catch (error) {
      console.error("Errore nell'uscita dal gruppo:", error);
      res.status(500).json({ message: "Errore del server", error });
  }
});

app.get('/user/:token', (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(401).json({ error: 'unknown token' });
    }

    const decoded = jwt.verify(token, SECRET_KEY);

    res.json({
      username: decoded.username,
      avatar: decoded.avatar
    });

  } catch (error) {
    console.error("Errore nel decoding del token:", error);
    res.status(401).json({ error: 'Token non valido' });
  }
});


app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
