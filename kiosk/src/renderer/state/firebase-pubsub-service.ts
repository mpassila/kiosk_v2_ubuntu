// Firebase Realtime Database Pub/Sub Service
// Provides real-time communication between kiosks and other services

import { getDatabase, ref, onValue, push, set, off, get, onChildAdded, DatabaseReference, Unsubscribe, query, startAfter, orderByKey } from 'firebase/database';
import { getFirebaseApp, registerLicenseDatabase } from './firebase-client';

export interface PubSubMessage {
  type: string;
  title: string;
  data: any;
  user: string;
  timestamp?: number;
  messageId?: string;
}

export type PubSubEventHandler = (message: PubSubMessage) => void;

export class FirebasePubSubService {
  private static subscriptions: Map<string, Unsubscribe> = new Map();
  private static databaseUrl: string | null = null;

  /**
   * Initialize the pub/sub service with database URL from license
   * @param databaseUrl Firebase Realtime Database URL from license
   */
  static initialize(databaseUrl: string): void {
    this.databaseUrl = databaseUrl;
    console.log('🔄 Firebase Pub/Sub Service initialized with database:', databaseUrl);
  }

  /**
   * Get database instance
   * If a custom database URL is set, it will use that, otherwise uses default
   */
  private static getDatabase() {
    const app = getFirebaseApp();

    if (this.databaseUrl) {
      // Use the database URL from license
      return getDatabase(app, this.databaseUrl);
    }

    // Fallback to default database
    return getDatabase(app);
  }

  /**
   * Ensure the pub/sub path exists for a device
   * Note: Firebase Realtime DB will auto-create paths when first message is published
   * This method just checks if the path exists without creating any initialization message
   * @param deviceDocId Device document ID (from Firebase)
   * @returns Promise that resolves to true if path exists
   */
  static async ensurePubSubPathExists(deviceDocId: string): Promise<boolean> {
    const pubsubPath = `pubsub/${deviceDocId}`;

    try {
      const db = this.getDatabase();
      const pubsubRef = ref(db, pubsubPath);

      // Check if path exists
      const snapshot = await get(pubsubRef);

      if (!snapshot.exists()) {
        console.log(`📝 Pubsub path does not exist yet: ${pubsubPath} (will be created on first publish)`);
      } else {
        console.log(`✅ Pubsub path already exists: ${pubsubPath}`);
      }

      return true;
    } catch (error: any) {
      // Permission denied is OK - the path will be auto-created on first publish
      if (error?.message?.includes('Permission denied') || error?.code === 'PERMISSION_DENIED') {
        console.log(`📝 Pubsub path ${pubsubPath} will be auto-created (read permission not required)`);
        return true; // Path will be created automatically
      }

      console.error(`❌ Error checking pubsub path for ${deviceDocId}:`, error);
      return false;
    }
  }

  /**
   * Subscribe to pub/sub messages for a specific device
   * @param deviceDocId Device document ID (from Firebase) to subscribe to
   * @param handler Callback function to handle incoming messages
   * @returns Unsubscribe function
   */
  static subscribe(deviceDocId: string, handler: PubSubEventHandler): () => void {
    try {
      const db = this.getDatabase();
      const pubsubPath = `pubsub/${deviceDocId}`;
      const pubsubRef = ref(db, pubsubPath);

      console.log(`📡 Subscribing to pubsub path: ${pubsubPath}`);

      // Track subscription time - only show messages that arrive AFTER subscription
      const subscriptionTime = Date.now();
      console.log(`⏰ Subscription timestamp: ${subscriptionTime} - will skip existing messages`);

      // Listen for new child nodes (messages)
      const unsubscribe = onChildAdded(pubsubRef, (snapshot) => {
        const messageId = snapshot.key;
        const messageData = snapshot.val();

        if (messageData) {
          const message: PubSubMessage = {
            ...messageData,
            messageId,
            timestamp: messageData.timestamp || Date.now()
          };

          // Skip messages that existed before subscription (on init, show nothing)
          if (message.timestamp && message.timestamp <= subscriptionTime) {
            console.log('⏭️  Skipping existing message from before subscription:', {
              messageId,
              messageTimestamp: message.timestamp,
              subscriptionTime
            });
            return;
          }

          console.log('📨 Received pub/sub message:', {
            messageId,
            type: message.type,
            title: message.title,
            user: message.user,
            data: message.data
          });

          // Call the handler (only for new messages after subscription)
          handler(message);
        }
      });

      // Store the unsubscribe function
      const key = `pubsub_${deviceDocId}`;
      this.subscriptions.set(key, unsubscribe);

      console.log(`✅ Successfully subscribed to ${pubsubPath}`);

      // Return unsubscribe function
      return () => {
        this.unsubscribe(deviceDocId);
      };
    } catch (error) {
      console.error(`❌ Error subscribing to pubsub/${deviceDocId}:`, error);
      return () => {}; // Return empty unsubscribe function
    }
  }

  /**
   * Unsubscribe from pub/sub messages for a device
   * @param deviceDocId Device document ID to unsubscribe from
   */
  static unsubscribe(deviceDocId: string): void {
    const key = `pubsub_${deviceDocId}`;
    const unsubscribe = this.subscriptions.get(key);

    if (unsubscribe) {
      unsubscribe();
      this.subscriptions.delete(key);
      console.log(`🔕 Unsubscribed from pubsub/${deviceDocId}`);
    }
  }

  /**
   * Publish a message to the pub/sub channel
   * @param deviceDocId Target device document ID
   * @param message Message to publish
   * @returns Promise that resolves with the message ID
   */
  static async publish(deviceDocId: string, message: Omit<PubSubMessage, 'timestamp' | 'messageId'>): Promise<string | null> {
    try {
      const db = this.getDatabase();
      const pubsubPath = `pubsub/${deviceDocId}`;
      const pubsubRef = ref(db, pubsubPath);

      // Add timestamp
      const messageWithTimestamp: PubSubMessage = {
        ...message,
        timestamp: Date.now()
      };

      // Push new message to the path
      const newMessageRef = push(pubsubRef);
      await set(newMessageRef, messageWithTimestamp);

      const messageId = newMessageRef.key;
      console.log(`📤 Published message to ${pubsubPath}:`, {
        messageId,
        type: message.type,
        title: message.title
      });

      return messageId;
    } catch (error) {
      console.error(`❌ Error publishing to pubsub/${deviceDocId}:`, error);
      return null;
    }
  }

  /**
   * Get all messages from a pub/sub channel
   * @param deviceDocId Device document ID
   * @returns Promise that resolves with array of messages
   */
  static async getMessages(deviceDocId: string): Promise<PubSubMessage[]> {
    try {
      const db = this.getDatabase();
      const pubsubPath = `pubsub/${deviceDocId}`;
      const pubsubRef = ref(db, pubsubPath);

      const snapshot = await get(pubsubRef);

      if (!snapshot.exists()) {
        console.log(`No messages found at ${pubsubPath}`);
        return [];
      }

      const messagesObj = snapshot.val();
      const messages: PubSubMessage[] = [];

      for (const [messageId, messageData] of Object.entries(messagesObj as Record<string, any>)) {
        messages.push({
          ...messageData,
          messageId,
          timestamp: messageData.timestamp || 0
        });
      }

      // Sort by timestamp (newest first)
      messages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      return messages;
    } catch (error) {
      console.error(`❌ Error getting messages from pubsub/${deviceDocId}:`, error);
      return [];
    }
  }

  /**
   * Clear all messages from a pub/sub channel
   * @param deviceDocId Device document ID
   */
  static async clearMessages(deviceDocId: string): Promise<void> {
    try {
      const db = this.getDatabase();
      const pubsubPath = `pubsub/${deviceDocId}`;
      const pubsubRef = ref(db, pubsubPath);

      await set(pubsubRef, null);
      console.log(`🗑️ Cleared all messages from ${pubsubPath}`);
    } catch (error) {
      console.error(`❌ Error clearing messages from pubsub/${deviceDocId}:`, error);
    }
  }

  /**
   * Unsubscribe from all channels
   */
  static unsubscribeAll(): void {
    console.log('🔕 Unsubscribing from all pub/sub channels...');
    this.subscriptions.forEach((unsubscribe, key) => {
      unsubscribe();
      console.log(`  - Unsubscribed from ${key}`);
    });
    this.subscriptions.clear();
  }

  /**
   * Get current database URL
   */
  static getDatabaseUrl(): string | null {
    return this.databaseUrl;
  }

  /**
   * Check if subscribed to a device
   * @param deviceDocId Device document ID
   */
  static isSubscribed(deviceDocId: string): boolean {
    return this.subscriptions.has(`pubsub_${deviceDocId}`);
  }

  /**
   * Get list of all subscribed device document IDs
   */
  static getSubscribedDevices(): string[] {
    return Array.from(this.subscriptions.keys())
      .map(key => key.replace('pubsub_', ''));
  }
}

// Export singleton instance for convenience
export const firebasePubSubService = FirebasePubSubService;
