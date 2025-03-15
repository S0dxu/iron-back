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
  methods: ["GET", "POST", "DELETE"],
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
  members: { type: Map, of: Number },
  startingPoint: { type: Number, required: true },
  increment: { type: Number, required: true }
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
    const token = jwt.sign({ userId: user._id, username: user.username, avatar: user.avatar, coin: user.coin }, SECRET_KEY, { expiresIn: "7d" });
    res.status(200).json({ message: "Login successful", token, username: user.username });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

app.post("/create-group", async (req, res) => {
  try {
    const { username, exercise, days, startingPoint, increment } = req.body;
    if (!username || !exercise || !days || !startingPoint || !increment) {
      return res.status(400).json({ message: "All fields are required" });
    }
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.currentGroup) {
      return res.status(400).json({ message: "You are already in a group. Please leave your current group before creating a new one." });
    }
    const groupId = uuidv4().slice(0, 12);
    const createdAt = new Date().toLocaleDateString("it-IT");
    const newGroup = new Group({
      groupId,
      createdAt,
      exercise,
      days,
      members: { [username]: 0 },
      startingPoint,
      increment
    });
    await newGroup.save();
    user.currentGroup = groupId;
    await user.save();
    res.status(201).json({ message: "Group created and joined successfully", groupId });
  } catch (error) {
    console.error("Error creating group:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

app.post("/join-group", async (req, res) => {
  try {
    const { groupId, username } = req.body;
    if (!groupId || !username) {
      return res.status(400).json({ message: "Group ID and username are required" });
    }
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.currentGroup) {
      return res.status(400).json({ message: "You are already in a group. Please leave your current group before joining another." });
    }
    const group = await Group.findOne({ groupId });
    if (!group) return res.status(404).json({ message: "Group not found" });
    group.members.set(username, 0);
    await group.save();
    user.currentGroup = groupId;
    await user.save();
    res.status(200).json({ message: "Joined group successfully!", members: Array.from(group.members.keys()) });
  } catch (error) {
    console.error("Error joining group:", error);
    res.status(500).json({ message: "Server error", error });
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
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.currentGroup) {
      return res.status(200).json({ message: "No group found", groupId: null });
    }
    const group = await Group.findOne({ groupId: user.currentGroup });
    if (!group) {
      user.currentGroup = null;
      await user.save();
      return res.status(404).json({ message: "The group no longer exists", groupId: null });
    }
    const groupStartDate = convertToDate(group.createdAt);
    if (isNaN(groupStartDate.getTime())) {
      console.error("Error: invalid creation date:", group.createdAt);
      return res.status(400).json({ message: "Invalid creation date" });
    }
    const groupDuration = Number(group.days);
    if (isNaN(groupDuration)) {
      console.error("Error: invalid group duration:", group.days);
      return res.status(400).json({ message: "Invalid group duration" });
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
      startingPoint: group.startingPoint,
      increment: group.increment,
      totals: group.days,
      history: user.history
    });
  } catch (error) {
    console.error("Error retrieving group:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

app.get("/change-picture", async (req, res) => {
  try {
    const { token, link } = req.query;

    if (!token || !link) {
      return res.status(400).json({ message: "Token or link missing" });
    }

    const decoded = jwt.verify(token, SECRET_KEY);
    const username = decoded.username;

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: "User not found" });

    user.avatar = link;
    await user.save();

    const newToken = jwt.sign(
      { userId: user._id, username: user.username, avatar: user.avatar, coin: user.coin },
      SECRET_KEY,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      message: "Profile picture updated successfully",
      newToken: newToken,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

app.delete("/delete-account", async (req, res) => {
  try {
      const { token } = req.query;

      if (!token) {
          return res.status(400).json({ message: "Token is required" });
      }

      const decoded = jwt.verify(token, SECRET_KEY);
      const username = decoded.username;

      const user = await User.findOneAndDelete({ username });

      if (!user) {
          return res.status(404).json({ message: "User not found" });
      }

      res.status(200).json({ message: "Account deleted successfully" });
  } catch (error) {
      console.error("Error deleting account:", error);
      res.status(500).json({ message: "Server error", error });
  }
});

app.post("/leave-group", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ message: "Username is required" });
    }
    const user = await User.findOne({ username });
    if (!user || !user.currentGroup) {
      return res.status(400).json({ message: "You are not in any group" });
    }
    const group = await Group.findOne({ groupId: user.currentGroup });
    if (!group) {
      user.currentGroup = null;
      await user.save();
      return res.status(404).json({ message: "Group not found, user status updated" });
    }
    group.members.delete(username);
    await group.save();
    user.coin = 0;
    user.history = [];
    await user.save();
    if (group.members.size === 0) {
      await Group.deleteOne({ groupId: group.groupId });
      return res.status(200).json({ message: "You have left the group and the group has been deleted because it was empty" });
    }
    user.currentGroup = null;
    await user.save();
    res.status(200).json({ message: "You have left the group successfully and your coins have been reset" });
  } catch (error) {
    console.error("Error leaving group:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

app.post("/cash", async (req, res) => {
  try {
    const { token, date } = req.body;
    if (!token || !date) {
      return res.status(400).json({ message: "Token and date are required" });
    }
    const decoded = jwt.verify(token, SECRET_KEY);
    const username = decoded.username;
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!user.currentGroup) {
      return res.status(400).json({ message: "User is not in any group" });
    }
    const group = await Group.findOne({ groupId: user.currentGroup });
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }
    const parts = group.createdAt.split('/');
    const groupStartDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    if (isNaN(groupStartDate.getTime())) {
      return res.status(400).json({ message: "Invalid group start date" });
    }
    const groupDuration = Number(group.days);
    if (isNaN(groupDuration)) {
      return res.status(400).json({ message: "Invalid group duration" });
    }
    const groupEndDate = new Date(groupStartDate);
    groupEndDate.setDate(groupEndDate.getDate() + groupDuration - 1);
    const partsDate = date.split('/');
    const providedDate = new Date(`${partsDate[2]}-${partsDate[1]}-${partsDate[0]}`);
    if (isNaN(providedDate.getTime())) {
      return res.status(400).json({ message: "Invalid provided date" });
    }
    if (providedDate > groupEndDate) {
      return res.status(400).json({ message: "Challenge period is over. You cannot receive cash after the challenge ends." });
    }
    if (user.history.includes(date)) {
      return res.status(400).json({ message: "Operation already executed for this date" });
    }
    user.history.push(date);
    user.coin += 500;
    await user.save();
    res.status(200).json({ 
      message: "Cash executed successfully", 
      coin: user.coin,
      username: user.username 
    });
  } catch (error) {
    console.error("Error in /cash endpoint:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

app.get('/user/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(401).json({ error: 'unknown token' });
    }
    const decoded = jwt.verify(token, SECRET_KEY);
    const username = decoded.username;
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({
      username: decoded.username,
      avatar: decoded.avatar,
      coin: user.coin,
    });
  } catch (error) {
    console.error("Error decoding token:", error);
    res.status(401).json({ error: "Invalid token" });
  }
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
