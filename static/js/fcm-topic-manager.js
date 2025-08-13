// Topic subscription helper for FCM notifications
class FCMTopicManager {
  constructor(fcmManager) {
    this.fcmManager = fcmManager;
    this.defaultTopic = 'mundo-dolphins-news';
  }

  /**
   * Subscribe user to a topic after getting FCM token
   * @param {string} topic - Topic name to subscribe to
   * @returns {Promise<boolean>} Success status
   */
  async subscribeToTopic(topic = this.defaultTopic) {
    try {
      if (!this.fcmManager || !this.fcmManager.token) {
        console.warn('⚠️ FCM not initialized or no token available');
        return false;
      }

      console.log(`🔔 Subscribing to topic: ${topic}`);

      // Store subscription locally for now
      const existingSubscriptions = this.getSubscriptions();
      if (!existingSubscriptions.includes(topic)) {
        existingSubscriptions.push(topic);
        localStorage.setItem('fcm_subscriptions', JSON.stringify(existingSubscriptions));
        
        console.log(`✅ Subscribed to topic: ${topic}`);
        this.showSubscriptionNotification(topic, 'subscribed');
        
        // TODO: Implement server-side topic subscription
        // When server is available, call this._subscribeToTopicOnServer(topic, token)
        
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
   * Server-side topic subscription (for future implementation)
   * @param {string} topic - Topic name
   * @param {string} token - FCM token
   * @returns {Promise<boolean>} Success status
   * @private
   */
  async _subscribeToTopicOnServer(topic, token) {
    // Example server implementation:
    /*
    const subscriptionData = {
      token: token,
      topic: topic,
      timestamp: Date.now(),
      action: 'subscribe'
    };
    
    const response = await fetch('/api/fcm/subscribe-topic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscriptionData)
    });
    
    if (response.ok) {
      console.log(`✅ Successfully subscribed to topic on server: ${topic}`);
      return true;
    } else {
      console.error(`❌ Failed to subscribe to topic on server: ${topic}`);
      return false;
    }
    */
    
    // For now, return true (local-only implementation)
    return true;
  }

  /**
   * Unsubscribe user from a topic
   * @param {string} topic - Topic name to unsubscribe from
   * @returns {Promise<boolean>} Success status
   */
  async unsubscribeFromTopic(topic = this.defaultTopic) {
    try {
      if (!this.fcmManager || !this.fcmManager.token) {
        console.warn('⚠️ FCM not initialized or no token available');
        return false;
      }

      console.log(`🔕 Unsubscribing from topic: ${topic}`);

      // Remove from local storage
      const existingSubscriptions = this.getSubscriptions();
      const updatedSubscriptions = existingSubscriptions.filter(t => t !== topic);
      localStorage.setItem('fcm_subscriptions', JSON.stringify(updatedSubscriptions));
      
      console.log(`✅ Unsubscribed from topic: ${topic}`);
      this.showSubscriptionNotification(topic, 'unsubscribed');
      
      // TODO: Implement server-side topic unsubscription
      // When server is available, call this._unsubscribeFromTopicOnServer(topic, token)
      
      return true;

    } catch (error) {
      console.error('❌ Error unsubscribing from topic:', error);
      return false;
    }
  }

  /**
   * Server-side topic unsubscription (for future implementation)
   * @param {string} topic - Topic name
   * @param {string} token - FCM token
   * @returns {Promise<boolean>} Success status
   * @private
   */
  async _unsubscribeFromTopicOnServer(topic, token) {
    // Example server implementation:
    /*
    const response = await fetch('/api/fcm/unsubscribe-topic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, topic })
    });
    
    return response.ok;
    */
    
    // For now, return true (local-only implementation)
    return true;
  }

  /**
   * Get current subscriptions
   * @returns {string[]} Array of subscribed topics
   */
  getSubscriptions() {
    try {
      const stored = localStorage.getItem('fcm_subscriptions');
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.warn('⚠️ Error reading topic subscriptions:', error);
      return [];
    }
  }

  /**
   * Check if user is subscribed to a topic
   * @param {string} topic - Topic to check
   * @returns {boolean} Subscription status
   */
  isSubscribedToTopic(topic) {
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
  // Wait for FCM to be ready
  const waitForFCM = () => {
    if (window.fcmManager && window.fcmManager.token) {
      console.log('🔔 Initializing Topic Manager...');
      
      const topicManager = new FCMTopicManager(window.fcmManager);
      
      // Auto-subscribe to news if FCM is working
      setTimeout(() => {
        topicManager.autoSubscribeToNews();
        topicManager.updateTopicUI();
      }, 1000);
      
      // Make available globally
      window.fcmTopicManager = topicManager;
      
    } else {
      // Try again in 500ms
      setTimeout(waitForFCM, 500);
    }
  };
  
  waitForFCM();
});

console.log('🔔 FCM Topic Manager script loaded');
