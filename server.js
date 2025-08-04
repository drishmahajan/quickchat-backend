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

// Data structures
const rooms = {};             // roomId => Set of usernames
const chatHistory = {};       // roomId => Array of messages
const socketToUserMap = {};   // socket.id => { username, roomId }

// Helper function to validate UUID format
const isValidUUID = (str) => {
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  return uuidRegex.test(str);
};

// Helper function to clean up empty rooms
const cleanupRoom = (roomId) => {
  if (rooms[roomId] && rooms[roomId].size === 0) {
    delete rooms[roomId];
    delete chatHistory[roomId];
    console.log(`🧹 Cleaned up empty room: ${roomId}`);
  }
};

io.on("connection", (socket) => {
  console.log(`👤 User connected: ${socket.id}`);

  socket.on("join-room", (roomId, username) => {
    // Validate room ID format
    if (!isValidUUID(roomId)) {
      socket.emit("room-error", "Invalid room ID format");
      return;
    }

    // Validate username
    if (!username || username.trim().length === 0) {
      socket.emit("room-error", "Username is required");
      return;
    }

    const cleanUsername = username.trim();
    
    // Leave any previous rooms
    const previousInfo = socketToUserMap[socket.id];
    if (previousInfo) {
      socket.leave(previousInfo.roomId);
      rooms[previousInfo.roomId]?.delete(previousInfo.username);
      cleanupRoom(previousInfo.roomId);
      // Notify previous room about user leaving
      io.to(previousInfo.roomId).emit("update-users", Array.from(rooms[previousInfo.roomId] || []));
    }

    // Join new room
    socket.join(roomId);
    socketToUserMap[socket.id] = { username: cleanUsername, roomId };

    // Initialize room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = new Set();
      console.log(`🏠 Created new room: ${roomId}`);
    }
    
    rooms[roomId].add(cleanUsername);

    console.log(`✅ ${cleanUsername} joined room: ${roomId}`);

    // Send chat history to the new user
    socket.emit("chat-history", chatHistory[roomId] || []);

    // Notify all users in the room about updated user list
    io.to(roomId).emit("update-users", Array.from(rooms[roomId]));

    // Optional: Send a system message when someone joins (uncomment if you want this feature)
    // const joinMessage = {
    //   message: `${cleanUsername} joined the chat`,
    //   username: "System",
    //   timestamp: new Date().toLocaleTimeString(),
    //   isSystem: true
    // };
    // if (!chatHistory[roomId]) chatHistory[roomId] = [];
    // chatHistory[roomId].push(joinMessage);
    // socket.to(roomId).emit("receive-message", joinMessage);
  });

  socket.on("send-message", ({ roomId, message, username, timestamp }) => {
    // Validate inputs
    if (!isValidUUID(roomId)) {
      socket.emit("room-error", "Invalid room ID");
      return;
    }

    if (!message || message.trim().length === 0) {
      return; // Ignore empty messages
    }

    if (!username || username.trim().length === 0) {
      socket.emit("room-error", "Username is required");
      return;
    }

    // Verify the user is actually in this room
    const userInfo = socketToUserMap[socket.id];
    if (!userInfo || userInfo.roomId !== roomId || userInfo.username !== username.trim()) {
      socket.emit("room-error", "Unauthorized message");
      return;
    }

    const msg = {
      message: message.trim(),
      username: username.trim(),
      timestamp: timestamp || new Date().toLocaleTimeString(),
    };

    // Initialize chat history if it doesn't exist
    if (!chatHistory[roomId]) {
      chatHistory[roomId] = [];
    }

    // Save message to history
    chatHistory[roomId].push(msg);

    // Keep only last 100 messages to prevent memory issues
    if (chatHistory[roomId].length > 100) {
      chatHistory[roomId] = chatHistory[roomId].slice(-100);
    }

    console.log(`💬 Message in ${roomId} from ${username}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);

    // Broadcast message to other users in the room
    socket.to(roomId).emit("receive-message", msg);
  });

  socket.on("disconnect", () => {
    console.log(`👤 User disconnected: ${socket.id}`);
    
    const userInfo = socketToUserMap[socket.id];
    if (userInfo) {
      const { username, roomId } = userInfo;
      
      // Remove user from room
      if (rooms[roomId]) {
        rooms[roomId].delete(username);
        console.log(`❌ ${username} left room: ${roomId}`);
        
        // Notify remaining users
        io.to(roomId).emit("update-users", Array.from(rooms[roomId]));
        
        // Optional: Send leave message (uncomment if you want this feature)
        // const leaveMessage = {
        //   message: `${username} left the chat`,
        //   username: "System",
        //   timestamp: new Date().toLocaleTimeString(),
        //   isSystem: true
        // };
        // if (chatHistory[roomId]) {
        //   chatHistory[roomId].push(leaveMessage);
        //   io.to(roomId).emit("receive-message", leaveMessage);
        // }
        
        // Clean up empty room
        cleanupRoom(roomId);
      }
    }
    
    // Remove socket mapping
    delete socketToUserMap[socket.id];
  });

  // Handle any other socket errors
  socket.on("error", (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🔄 SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("🔄 SIGINT received, shutting down gracefully");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
  console.log(`📱 Socket.IO server ready for connections`);
});