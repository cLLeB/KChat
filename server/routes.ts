import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { insertChatRoomSchema, insertChatMessageSchema, insertChatParticipantSchema } from "@shared/schema";
import { randomUUID } from "crypto";

interface ExtendedWebSocket extends WebSocket {
  roomId?: string;
  participantId?: string;
  nickname?: string;
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // WebSocket server for real-time messaging
  const wss = new WebSocketServer({
    server: httpServer,
    perMessageDeflate: false, // Disable compression for better proxy compatibility
    clientTracking: true,
    verifyClient: (info: any, callback) => {
      // Log WebSocket connection attempts for debugging
      console.log(`[WebSocket] Connection attempt from ${info.origin} to ${info.req.url}`);
      // Allow all connections for now - can add authentication later
      callback(true);
    }
  });

  wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
  });

  wss.on('connection', (ws: ExtendedWebSocket, request) => {
    console.log(`[WebSocket] New connection established from ${request.socket.remoteAddress}`);
    const connectionId = randomUUID();
    connections.set(connectionId, ws);
    
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
          case 'join_room':
            await handleJoinRoom(ws, message, connectionId);
            break;
            
          case 'send_message':
            await handleSendMessage(ws, message);
            break;
            
          case 'typing':
            await handleTyping(ws, message);
            break;
            
          case 'call_offer':
            await handleCallOffer(ws, message);
            break;
            
          case 'call_answer':
            await handleCallAnswer(ws, message);
            break;
            
          case 'call_ice_candidate':
            await handleCallIceCandidate(ws, message);
            break;
            
          case 'call_rejected':
            await handleCallRejected(ws, message);
            break;
            
          case 'call_ended':
            await handleCallEnded(ws, message);
            break;
            
          case 'leave_room':
            await handleLeaveRoom(ws, connectionId);
            break;
        }
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
      }
    });
    
    ws.on('close', () => {
      console.log('WebSocket connection closed');
      handleLeaveRoom(ws, connectionId);
      connections.delete(connectionId);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      connections.delete(connectionId);
    });
  });
  
  console.log('WebSocket server initialized on path /ws');
  
  // Store active connections
  const connections = new Map<string, ExtendedWebSocket>();
  // Keep track of scheduled deletion timers for messages
  const deletionTimers = new Map<string, NodeJS.Timeout>();

  // Rehydrate deletion timers for any messages that have an expiresAt in the future
  (async () => {
    try {
      const allMessages = await storage.getAllMessages();
      const now = Date.now();
      allMessages.forEach((m) => {
        if (m.expiresAt && m.expiresAt.getTime() > now) {
          const ms = m.expiresAt.getTime() - now;
          const t = setTimeout(() => {
            storage.deleteMessage(m.id).catch(console.error);
            deletionTimers.delete(m.id);
          }, ms);
          deletionTimers.set(m.id, t);
        }
      });
    } catch (e) {
      console.error('Failed to rehydrate message deletion timers', e);
    }
  })();
  
  // API Routes
  
  // Health check endpoint for Docker/container health checks
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // WebSocket health check
  app.get('/api/health/ws', (req, res) => {
    res.status(200).json({
      status: 'websocket_healthy',
      timestamp: new Date().toISOString(),
      connections: connections.size
    });
  });

  // WebSocket connection test endpoint
  app.get('/api/test/ws', (req, res) => {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const wsUrl = `${protocol === 'https' ? 'wss' : 'ws'}://${host}/ws`;

    res.json({
      status: 'websocket_test',
      websocketUrl: wsUrl,
      currentConnections: connections.size,
      timestamp: new Date().toISOString(),
      instructions: 'Use this URL in your WebSocket client: ' + wsUrl
    });
  });
  
  // Create a new chat room
  app.post('/api/chat/create', async (req, res) => {
    try {
      const roomId = randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      const defaultMessageTTLSeconds = typeof req.body?.defaultMessageTTLSeconds === 'number'
        ? req.body.defaultMessageTTLSeconds
        : undefined;

      const room = await storage.createChatRoom({
        id: roomId,
        expiresAt,
        // include provided TTL if present (storage will handle defaulting)
        ...(defaultMessageTTLSeconds ? { defaultMessageTTLSeconds } : {}),
      } as any);
      
      res.json({ 
        roomId: room.id,
        link: `${process.env.NODE_ENV === 'production' ? 'https' : req.protocol}://${req.get('host')}/chat/${room.id}`,
        expiresAt: room.expiresAt
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create chat room' });
    }
  });
  
  // Get chat room info
  app.get('/api/chat/:roomId', async (req, res) => {
    try {
      const { roomId } = req.params;
      console.log(`[Room Lookup] Room ID: ${roomId}, Host: ${req.get('host')}, Protocol: ${req.protocol}`);

      const room = await storage.getChatRoom(roomId);

      if (!room) {
        console.log(`[Room Lookup] Room not found: ${roomId}`);
        return res.status(404).json({ error: 'Chat room not found' });
      }

      if (room.expiresAt && room.expiresAt < new Date()) {
        console.log(`[Room Lookup] Room expired: ${roomId}`);
        await storage.deleteChatRoom(roomId);
        return res.status(410).json({ error: 'Chat room has expired' });
      }

      const participants = await storage.getParticipants(roomId);

      console.log(`[Room Lookup] Room found: ${roomId}, Participants: ${participants.length}`);

      res.json({
        room,
        participantCount: participants.length,
        canJoin: participants.length < 2
      });
    } catch (error) {
      console.error(`[Room Lookup] Error for room ${req.params.roomId}:`, error);
      res.status(500).json({ error: 'Failed to get chat room' });
    }
  });
  
  // Get chat messages
  app.get('/api/chat/:roomId/messages', async (req, res) => {
    try {
      const { roomId } = req.params;
      const messages = await storage.getMessages(roomId);
      
      // Filter out expired or viewed view-once messages
      const validMessages = messages.filter(message => {
        if (message.expiresAt && message.expiresAt < new Date()) return false;
        if (message.isViewOnce && message.hasBeenViewed) return false;
        return true;
      });
      
      res.json(validMessages);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get messages' });
    }
  });
  
  // Mark message as viewed
  app.post('/api/chat/message/:messageId/view', async (req, res) => {
    try {
      const { messageId } = req.params;
      await storage.markMessageViewed(messageId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to mark message as viewed' });
    }
  });
  
  // WebSocket connection handling
  wss.on('connection', (ws: ExtendedWebSocket, request) => {
    console.log('New WebSocket connection established');
    const connectionId = randomUUID();
    connections.set(connectionId, ws);
    
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
          case 'join_room':
            await handleJoinRoom(ws, message, connectionId);
            break;
            
          case 'send_message':
            await handleSendMessage(ws, message);
            break;
            
          case 'typing':
            await handleTyping(ws, message);
            break;
            
          case 'call_offer':
            await handleCallOffer(ws, message);
            break;
            
          case 'call_answer':
            await handleCallAnswer(ws, message);
            break;
            
          case 'call_ice_candidate':
            await handleCallIceCandidate(ws, message);
            break;
            
          case 'call_rejected':
            await handleCallRejected(ws, message);
            break;
            
          case 'call_ended':
            await handleCallEnded(ws, message);
            break;
            
          case 'leave_room':
            await handleLeaveRoom(ws, connectionId);
            break;
        }
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
      }
    });
    
    ws.on('close', () => {
      console.log('WebSocket connection closed');
      handleLeaveRoom(ws, connectionId);
      connections.delete(connectionId);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      connections.delete(connectionId);
    });
  });
  
  async function handleJoinRoom(ws: ExtendedWebSocket, message: any, connectionId: string) {
    const { roomId, nickname, publicKey } = message;
    
    try {
      const room = await storage.getChatRoom(roomId);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }));
        return;
      }
      
      if (room.expiresAt && room.expiresAt < new Date()) {
        ws.send(JSON.stringify({ type: 'error', error: 'Room has expired' }));
        return;
      }
      
      const participants = await storage.getParticipants(roomId);
      if (participants.length >= 2) {
        ws.send(JSON.stringify({ type: 'error', error: 'Room is full' }));
        return;
      }
      
      // Add participant
      const participant = await storage.addParticipant({
        roomId,
        nickname,
        publicKey,
      });
      
      ws.roomId = roomId;
      ws.participantId = participant.id;
      ws.nickname = nickname;
      
      // Activate room if this is the second participant
      if (participants.length === 1) {
        await storage.updateChatRoom(roomId, { isActive: true });
      }
      
      // Notify all participants in the room
      broadcastToRoom(roomId, {
        type: 'user_joined',
        participant: {
          id: participant.id,
          nickname: participant.nickname,
          publicKey: participant.publicKey
        },
        participantCount: participants.length + 1
      });
      
      // Send current participants to new user
      const allParticipants = await storage.getParticipants(roomId);
      ws.send(JSON.stringify({
        type: 'room_joined',
        roomId,
        participants: allParticipants,
        participant: participant
      }));
      
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', error: 'Failed to join room' }));
    }
  }
  
  async function handleSendMessage(ws: ExtendedWebSocket, message: any) {
    if (!ws.roomId || !ws.participantId) {
      ws.send(JSON.stringify({ type: 'error', error: 'Not in a room' }));
      return;
    }
    
    try {
      const { content, messageType, encryptedData, isViewOnce, expiresAt: clientExpiresAt } = message;

      // Determine expiresAt: prefer explicit client-provided expiresAt, otherwise use room default TTL
      let expiresAt: Date | null = null;
      if (clientExpiresAt) {
        expiresAt = new Date(clientExpiresAt);
      } else {
        const room = await storage.getChatRoom(ws.roomId!);
        const ttl = room && (room as any).defaultMessageTTLSeconds ? ((room as any).defaultMessageTTLSeconds as number) : null;
        if (ttl && typeof ttl === 'number') {
          expiresAt = new Date(Date.now() + ttl * 1000);
        } else {
          // fallback defaults
          expiresAt = isViewOnce ? new Date(Date.now() + 60 * 1000) : new Date(Date.now() + 10 * 60 * 1000);
        }
      }
      
      const chatMessage = await storage.createMessage({
        roomId: ws.roomId,
        senderNickname: ws.nickname!,
        content,
        messageType: messageType || 'text',
        encryptedData,
        isViewOnce: isViewOnce || false,
        expiresAt,
      });
      
      // Broadcast message to all participants in the room
      broadcastToRoom(ws.roomId, {
        type: 'new_message',
        message: chatMessage
      });

      // Schedule deletion at expiresAt if present
      if (chatMessage.expiresAt) {
        const ms = chatMessage.expiresAt.getTime() - Date.now();
        if (ms > 0) {
          const t = setTimeout(() => {
            storage.deleteMessage(chatMessage.id).catch(console.error);
            deletionTimers.delete(chatMessage.id);
          }, ms);
          deletionTimers.set(chatMessage.id, t);
        } else {
          // already expired - delete immediately
          await storage.deleteMessage(chatMessage.id);
        }
      }
      
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', error: 'Failed to send message' }));
    }
  }
  
  async function handleTyping(ws: ExtendedWebSocket, message: any) {
    if (!ws.roomId) return;
    
    broadcastToRoom(ws.roomId, {
      type: 'typing',
      participantId: ws.participantId,
      nickname: ws.nickname,
      isTyping: message.isTyping
    }, ws.participantId);
  }
  
  async function handleLeaveRoom(ws: ExtendedWebSocket, connectionId: string) {
    if (!ws.roomId || !ws.participantId) return;
    
    try {
      await storage.removeParticipant(ws.participantId);
      
      broadcastToRoom(ws.roomId, {
        type: 'user_left',
        participantId: ws.participantId,
        nickname: ws.nickname
      });
      
      // Check if room should be deactivated or deleted
      const participants = await storage.getParticipants(ws.roomId);
      if (participants.length === 0) {
        await storage.deleteChatRoom(ws.roomId);
      } else if (participants.length === 1) {
        await storage.updateChatRoom(ws.roomId, { isActive: false });
      }
      
    } catch (error) {
      console.error('Error handling leave room:', error);
    }
  }
  
  async function handleCallOffer(ws: ExtendedWebSocket, message: any) {
    if (!ws.roomId) return;
    
    // Add sender nickname to the offer
    const callOfferMessage = {
      ...message,
      fromNickname: ws.nickname
    };
    
    // Send offer to the target participant
    broadcastToRoom(ws.roomId, callOfferMessage, ws.participantId);
  }
  
  async function handleCallAnswer(ws: ExtendedWebSocket, message: any) {
    if (!ws.roomId) return;
    
    // Forward the answer to the caller
    broadcastToRoom(ws.roomId, message, ws.participantId);
  }
  
  async function handleCallIceCandidate(ws: ExtendedWebSocket, message: any) {
    if (!ws.roomId) return;
    
    // Forward ICE candidate to the other participant
    broadcastToRoom(ws.roomId, message, ws.participantId);
  }
  
  async function handleCallRejected(ws: ExtendedWebSocket, message: any) {
    if (!ws.roomId) return;
    
    // Forward rejection to the caller
    broadcastToRoom(ws.roomId, message, ws.participantId);
  }
  
  async function handleCallEnded(ws: ExtendedWebSocket, message: any) {
    if (!ws.roomId) return;
    
    // Forward call end to the other participant
    broadcastToRoom(ws.roomId, message, ws.participantId);
  }

  function broadcastToRoom(roomId: string, message: any, excludeParticipantId?: string) {
    connections.forEach((ws: ExtendedWebSocket) => {
      if (ws.roomId === roomId && 
          ws.readyState === WebSocket.OPEN && 
          ws.participantId !== excludeParticipantId) {
        ws.send(JSON.stringify(message));
      }
    });
  }

  // Listen for deletions from storage and broadcast to clients
  storage.events.on('message_deleted', (data: { messageId: string, roomId: string }) => {
    try {
      const { messageId, roomId } = data;
      // clear any scheduled timer
      const t = deletionTimers.get(messageId);
      if (t) {
        clearTimeout(t as unknown as NodeJS.Timeout);
        deletionTimers.delete(messageId);
      }

      broadcastToRoom(roomId, { type: 'message_deleted', messageId });
    } catch (e) {
      console.error('Error handling storage message_deleted event', e);
    }
  });

  return httpServer;
}
