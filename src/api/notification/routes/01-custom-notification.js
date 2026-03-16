module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/notifications/me',
      handler: 'notification.getMyNotifications',
    },
    {
      method: 'PUT',
      path: '/notifications/:documentId/read',
      handler: 'notification.markRead',
    },
    {
      method: 'PUT',
      path: '/notifications/:documentId/unread',
      handler: 'notification.markUnread',
    },
    {
      method: 'PUT',
      path: '/notifications/mark-all-read',
      handler: 'notification.markAllRead',
    }
  ],
};