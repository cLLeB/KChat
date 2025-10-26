import { encryptionService } from './encryption';

export interface ChatMessage {
  id: string;
  roomId: string;
  senderNickname: string;
  content: string;
  messageType: 'text' | 'image';
  encryptedData?: string;
  isViewOnce: boolean;
  hasBeenViewed: boolean;
  createdAt: Date;
  expiresAt?: Date;
}

export interface ChatParticipant {
  id: string;
  roomId: string;
  nickname: string;
  publicKey?: string;
  isOnline: boolean;
  joinedAt: Date;
}

export interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private messageHandlers: Map<string, (data: any) => void> = new Map();
  
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Dynamically construct WebSocket URL based on current location
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        
        // FIXED: Remove the /ws path - connect directly to the host
        // Render serves WebSocket on the same domain without path
        const wsUrl = `${protocol}//${host}`;

        console.log(`[WebSocket] Connecting to ${wsUrl}`);
        console.log(`[WebSocket] Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`[WebSocket] Protocol: ${protocol}, Host: ${host}`);
        
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('[WebSocket] Connected successfully');
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000; // Reset delay
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onclose = (event) => {
          console.log(`[WebSocket] Disconnected (code: ${event.code}, reason: ${event.reason})`);
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('[WebSocket] Connection error:', error);
          console.error('[WebSocket] State:', this.ws?.readyState);
          console.error('[WebSocket] URL:', wsUrl);
          reject(error);
        };

        // Timeout after 10 seconds
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            console.error('[WebSocket] Connection timeout');
            this.ws.close();
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000);

      } catch (error) {
        console.error('[WebSocket] Setup error:', error);
        reject(error);
      }
    });
  }
  
  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
      console.log(`[WebSocket] Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`);

      setTimeout(() => {
        this.connect().catch((error) => {
          console.error(`[WebSocket] Reconnection attempt ${this.reconnectAttempts} failed:`, error);
        });
      }, delay);
    } else {
      console.error('[WebSocket] Max reconnection attempts reached');
      // Notify any listeners that connection failed permanently
      this.messageHandlers.forEach((handler, type) => {
        if (type === 'connection_failed') {
          handler({ attempts: this.maxReconnectAttempts });
        }
      });
    }
  }
  
  private handleMessage(message: WebSocketMessage) {
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      handler(message);
    } else {
      console.warn('No handler for message type:', message.type);
    }
  }
  
  on(messageType: string, handler: (data: any) => void) {
    this.messageHandlers.set(messageType, handler);
  }
  
  off(messageType: string) {
    this.messageHandlers.delete(messageType);
  }
  
  send(message: WebSocketMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket is not connected');
    }
  }
  
  async joinRoom(roomId: string, nickname: string): Promise<void> {
    await encryptionService.generateKeyPair();
    const publicKey = await encryptionService.exportPublicKey();
    
    this.send({
      type: 'join_room',
      roomId,
      nickname,
      publicKey
    });
  }
  
  async sendMessage(content: string, messageType: 'text' | 'image' = 'text', isViewOnce = false) {
    // For now, send unencrypted content
    // In a full implementation, you would encrypt the content here
    this.send({
      type: 'send_message',
      content,
      messageType,
      isViewOnce
    });
  }
  
  sendTyping(isTyping: boolean) {
    this.send({
      type: 'typing',
      isTyping
    });
  }
  
  leaveRoom() {
    this.send({
      type: 'leave_room'
    });
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const webSocketService = new WebSocketService();