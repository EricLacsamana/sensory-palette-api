'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::activity-session.activity-session', ({ strapi }) => ({
  async getUnavailableSlots(ctx) {
    try {
      const { date, studentId, therapistId } = ctx.query;
      const user = ctx.state.user;

      const targetTherapistId = user.role.type === 'secretary' ? therapistId : user.id;

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const sessions = await strapi.documents('api::activity-session.activity-session').findMany({
        filters: {
          $and: [
            { startTime: { $gte: startOfDay.toISOString() } },
            { startTime: { $lte: endOfDay.toISOString() } },
            // LOGIC: Only consider sessions that are currently 'started' or successfully 'completed'
            // This ignores 'abandoned' or 'interrupted' sessions so the time can be reused.
            { activityStatus: { $in: ['started', 'completed'] } }, 
            {
              $or: [
                { student: { id: { $eq: studentId } } },
                { therapist: { id: { $eq: targetTherapistId } } }
              ]
            }
          ]
        },
        fields: ['startTime', 'endTime'],
        populate: {
          student: { fields: ['id'] },
          therapist: { fields: ['id'] }
        }
      });

      return sessions.map(s => ({
        start: s.startTime,
        end: s.endTime,
        conflict: s.student?.id === Number(studentId) ? 'student' : 'therapist'
      }));
    } catch (error) {
      ctx.throw(500, error);
    }
  },
}));