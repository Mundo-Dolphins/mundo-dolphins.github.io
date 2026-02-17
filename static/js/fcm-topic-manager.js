// Topic subscription helper for FCM notifications

// Configuration constants
const FCM_CONFIG = {
  INITIALIZATION_TIMEOUT_MS: 10000,  // Total time to wait for FCM initialization (e.g., 10 seconds)
  MAX_INITIALIZATION_RETRIES: 20,    // Maximum attempts to wait for FCM initialization (calculated: 10000ms / 500ms = 20 retries)
  RETRY_DELAY_MS: 500,               // Delay between FCM initialization retry attempts
  AUTO_SUBSCRIBE_DELAY_MS: 1000,     // Delay before auto-subscribing to ensure FCM is fully ready
};

class FCMTopicManager {
  constructor(fcmManager) {
    this.fcmManager = fcmManager;
    this.defaultTopic = 'mundo-dolphins-news';
  }

  /**
   * Validates an FCM topic name according to the following rules:
   * - The topic name must be a non-empty string.
   * - Only alphanumeric characters (A-Z, a-z, 0-9), hyphens (-), and underscores (_) are allowed.
   * - No spaces or other special characters are permitted.
   * - The validation is performed using the regular expression: /^[A-Za-z0-9_-]+$/
   *
   * Examples:
   *   Valid:   "news", "topic_123", "my-topic"
   *   Invalid: "", "topic name", "topic@123", "topic!"
   *
   * @param {string} topic - The topic name to validate.
   * @returns {boolean} True if the topic name is valid, false otherwise.
   * @private
   */
  isValidTopicName(topic) {
    return (
      typeof topic === 'string' &&
      topic.length > 0 &&
      /^[A-Za-z0-9_-]+$/.test(topic)
    );
  }

  /**
   * Subscribe user to a topic after getting FCM token
   * @param {string} topic - Topic name to subscribe to
   * @returns {Promise<boolean>} Success status
   */
  async subscribeToTopic(topic = this.defaultTopic) {
    try {
      if (!this.isValidTopicName(topic)) {
        console.warn('⚠️ Invalid topic name. Must be non-empty and contain only alphanumeric characters, hyphens, and underscores.');
        return false;
      }
      if (!this.fcmManager || !this.fcmManager.token) {
        console.warn('⚠️ FCM not initialized or no token available. Please check your browser compatibility or refresh the page.');
        return false;
      }
      console.log(`🔔 Subscribing to topic: ${topic}`);
      const existingSubscriptions = this.getSubscriptions();
      if (!existingSubscriptions.includes(topic)) {
        existingSubscriptions.push(topic);
        localStorage.setItem('fcm_subscriptions', JSON.stringify(existingSubscriptions));
        console.log(`✅ Subscribed to topic: ${topic}`);
        this.showSubscriptionNotification(topic, 'subscribed');
        // No server-side subscription implementado aún
        return true;
      } else {
        console.log(`ℹ️ Already subscribed to topic: ${topic}`);
        return true;
      }
    } catch (error) {
      console.error('❌ Error subscribing to topic:', error);
      return false;
    }
  }

  /**
   * Unsubscribe user from a topic
   * @param {string} topic - Topic name to unsubscribe from
   * @returns {Promise<boolean>} Success status
   */
  async unsubscribeFromTopic(topic = this.defaultTopic) {
    try {
      if (!this.isValidTopicName(topic)) {
        console.warn('⚠️ Invalid topic name. Must be non-empty and contain only alphanumeric characters, hyphens, and underscores.');
        return false;
      }
      if (!this.fcmManager || !this.fcmManager.token) {
        console.warn('⚠️ FCM not initialized or no token available. Please check your browser compatibility or refresh the page.');
        return false;
      }
      console.log(`🔕 Unsubscribing from topic: ${topic}`);
      const existingSubscriptions = this.getSubscriptions();
      const updatedSubscriptions = existingSubscriptions.filter(t => t !== topic);
      localStorage.setItem('fcm_subscriptions', JSON.stringify(updatedSubscriptions));
      console.log(`✅ Unsubscribed from topic: ${topic}`);
      this.showSubscriptionNotification(topic, 'unsubscribed');
      // No server-side unsubscription implementado aún
      return true;
    } catch (error) {
      console.error('❌ Error unsubscribing from topic:', error);
      return false;
    }
  }

  /**
   * Get current subscriptions
   * @returns {string[]} Array of subscribed topics
   */
  getSubscriptions() {
    try {
      const stored = localStorage.getItem('fcm_subscriptions');
      if (!stored) {
        return [];
      }
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
  console.warn('⚠️ Invalid subscription data format in localStorage, resetting...');
        localStorage.removeItem('fcm_subscriptions');
        return [];
      }
      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.error('❌ Corrupted subscription data in localStorage (invalid JSON). Clearing corrupted data:', error);
        localStorage.removeItem('fcm_subscriptions');
      } else {
        console.error('❌ Error reading topic subscriptions from localStorage:', error);
      }
      return [];
    }
  }

  /**
   * Check if user is subscribed to a topic
   * @param {string} topic - Topic to check
   * @returns {boolean} Subscription status
   */
  isSubscribedToTopic(topic) {
    if (!this.isValidTopicName(topic)) return false;
    return this.getSubscriptions().includes(topic);
  }

  /**
   * Subscribe to default news topic automatically
   */
  async autoSubscribeToNews() {
    if (!this.isSubscribedToTopic(this.defaultTopic)) {
      console.log('🔔 Auto-subscribing to news updates...');
      return await this.subscribeToTopic(this.defaultTopic);
    }
    return true;
  }

  /**
   * Show notification about subscription change
   * @param {string} topic - Topic name
   * @param {string} action - 'subscribed' or 'unsubscribed'
   */
  showSubscriptionNotification(topic, action) {
    if (this.fcmManager && this.fcmManager.showLocalNotification) {
      const title = action === 'subscribed' ? 
        '🔔 Suscripción Activada' : 
        '🔕 Suscripción Desactivada';
      
      const body = action === 'subscribed' ? 
        `Te notificaremos sobre nuevos contenidos de ${topic}` :
        `Ya no recibirás notificaciones de ${topic}`;

      this.fcmManager.showLocalNotification(title, body);
    }
  }

  /**
   * Update UI to show subscription status
   */
  updateTopicUI() {
    const newsSubscriptionBtn = document.getElementById('news-subscription-btn');
    const subscriptionStatus = document.getElementById('topic-subscription-status');
    
    if (newsSubscriptionBtn && subscriptionStatus) {
      const isSubscribed = this.isSubscribedToTopic(this.defaultTopic);
      
      newsSubscriptionBtn.textContent = isSubscribed ? 
        '🔕 Desuscribirse de Noticias' : 
        '🔔 Suscribirse a Noticias';
      
      newsSubscriptionBtn.onclick = () => {
        if (isSubscribed) {
          this.unsubscribeFromTopic(this.defaultTopic).then(() => this.updateTopicUI());
        } else {
          this.subscribeToTopic(this.defaultTopic).then(() => this.updateTopicUI());
        }
      };
      
      subscriptionStatus.textContent = isSubscribed ? 
        '✅ Suscrito a notificaciones de noticias' : 
        '🔔 Puedes suscribirte a notificaciones de noticias';
    }
  }
}

// Auto-initialize when FCM is ready
document.addEventListener('DOMContentLoaded', function() {
  let topicManager = null;
  let topicManagerInitialized = false;

  const initTopicManager = () => {
    if (topicManagerInitialized || !isFCMInitialized(window.fcmManager)) {
      return;
    }
    topicManagerInitialized = true;
    console.log('🔔 Initializing Topic Manager...');
    topicManager = new FCMTopicManager(window.fcmManager);
    setTimeout(() => {
      topicManager.autoSubscribeToNews();
      topicManager.updateTopicUI();
    }, FCM_CONFIG.AUTO_SUBSCRIBE_DELAY_MS);
    window.fcmTopicManager = topicManager;
  };

  // Helper to check if FCM is initialized
  function isFCMInitialized(fcmManager) {
    if (!fcmManager) return false;
    if (typeof fcmManager.isInitialized === 'function') {
      return fcmManager.isInitialized();
    }
    return !!fcmManager.token;
  }

  // Wait for FCM to be ready with timeout protection
  const waitForFCM = (retryCount = 0, maxRetries = FCM_CONFIG.MAX_INITIALIZATION_RETRIES) => {
    if (isFCMInitialized(window.fcmManager)) {
      initTopicManager();
    } else if (retryCount < maxRetries) {
      setTimeout(() => waitForFCM(retryCount + 1, maxRetries), FCM_CONFIG.RETRY_DELAY_MS);
    } else {
      console.warn('⚠️ FCM initialization timeout reached. Topic manager will not be available. Please check your browser compatibility, ensure notifications are enabled, and try refreshing the page.');
      const subscriptionStatus = document.getElementById('topic-subscription-status');
      if (subscriptionStatus) {
        subscriptionStatus.textContent = '⚠️ Push notifications not available';
      }
    }
  };
  window.addEventListener('fcm:ready', () => {
    initTopicManager();
  });
  waitForFCM();
});

console.log('🔔 FCM Topic Manager script loaded');
