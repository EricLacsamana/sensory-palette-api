'use strict';
const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::notification.notification', ({ strapi }) => ({
  
  // Fetch ALL recent notifications (both read and unread)
  async getMyNotifications(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in');

    const notifications = await strapi.documents('api::notification.notification').findMany({
      filters: {
        user: user.id, 
      },
      sort: ['createdAt:desc'],
      limit: 50, // Keep it to the most recent 50
      populate: {
        activitySession: {
          populate: ['activity', 'student']
        }
      }
    });

    return ctx.send(notifications);
  },

  async markRead(ctx) {
    const user = ctx.state.user;
    const { documentId } = ctx.params;
    if (!user) return ctx.unauthorized();

    const notif = await strapi.documents('api::notification.notification').findOne({ documentId, populate: ['user'] });
    if (!notif || notif.user?.id !== user.id) return ctx.unauthorized();

    const updated = await strapi.documents('api::notification.notification').update({
      documentId, data: { isRead: true }
    });
    return ctx.send(updated);
  },

  // NEW: Mark a notification as unread
  async markUnread(ctx) {
    const user = ctx.state.user;
    const { documentId } = ctx.params;
    if (!user) return ctx.unauthorized();

    const notif = await strapi.documents('api::notification.notification').findOne({ documentId, populate: ['user'] });
    if (!notif || notif.user?.id !== user.id) return ctx.unauthorized();

    const updated = await strapi.documents('api::notification.notification').update({
      documentId, data: { isRead: false }
    });
    return ctx.send(updated);
  },

  async markAllRead(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const unread = await strapi.documents('api::notification.notification').findMany({
      filters: { user: user.id, isRead: false },
      select: ['documentId']
    });

    await Promise.all(unread.map(n => 
      strapi.documents('api::notification.notification').update({
        documentId: n.documentId, data: { isRead: true }
      })
    ));

    return ctx.send({ message: 'All notifications marked as read' });
  }
}));