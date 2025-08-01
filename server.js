const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// ✅ Only declare these once
const rooms = {};             // roomId => Set of usernames
const chatHistory = {};       // roomId => Array of messages
const socketToUserMap = {};   // socket.id => { username, roomId }

io.on("connection", (socket) => {
  socket.on("join-room", (roomId, username) => {
    socket.join(roomId);
    socketToUserMap[socket.id] = { username, roomId };

    if (!rooms[roomId]) rooms[roomId] = new Set();
    rooms[roomId].add(username);

    // ✅ Send chat history to new user
    socket.emit("chat-history", chatHistory[roomId] || []);

    // ✅ Notify all users of updated user list
    io.to(roomId).emit("update-users", Array.from(rooms[roomId]));
  });

  socket.on("send-message", ({ roomId, message, username, timestamp }) => {
    const msg = { message, username, timestamp };

    // ✅ Save message
    if (!chatHistory[roomId]) chatHistory[roomId] = [];
    chatHistory[roomId].push(msg);

    // ✅ Broadcast to others
    socket.to(roomId).emit("receive-message", msg);
  });

  socket.on("disconnect", () => {
    const info = socketToUserMap[socket.id];
    if (info) {
      const { username, roomId } = info;
      rooms[roomId]?.delete(username);
      if (rooms[roomId]?.size === 0) {
        delete rooms[roomId];
        delete chatHistory[roomId]; // Optional: cleanup history when room is empty
      }
      io.to(roomId).emit("update-users", Array.from(rooms[roomId] || []));
    }
    delete socketToUserMap[socket.id];
  });
});

server.listen(5000, () => {
  console.log("✅ Server is running on http://localhost:5000");
});
