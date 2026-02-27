const { ApplicationError } = require('@strapi/utils').errors;
const crypto = require('crypto');

module.exports = {
  // 1. Generate the Friendly ID the moment it gets added to the calendar
  async beforeCreate(event) {
    const { data } = event.params;
    if (!data.sessionId) {
      data.sessionId = `ACT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    }
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;

    // Check if the session is specifically being set to in_progress
    if (data.activitySessionStatus === 'in_progress') {
      
      // THE INTERLOCK: Fetch the current database state for this session
      const currentSession = await strapi.db.query('api::activity-session.activity-session').findOne({
        where: { id: where.id },
        populate: ['student'],
      });

      // BYPASS: If the session is ALREADY 'in_progress', allow the update to proceed.
      // This prevents the interlock from blocking its own session during telemetry updates.
      if (currentSession?.activitySessionStatus === 'in_progress') {
        return; 
      }

      // Fallback: Generate ID if it somehow missed the beforeCreate hook
      if (!data.sessionId && !currentSession?.sessionId) {
        data.sessionId = `ACT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      }

      // Ensure the student exists before checking for conflicts
      if (currentSession?.student?.id) {
        const runningSession = await strapi.db.query('api::activity-session.activity-session').findOne({
          where: {
            student: currentSession.student.id,
            activitySessionStatus: 'in_progress',
            id: { $ne: where.id } // Redundant but safe check
          },
          select: ['id']
        });

        // ENFORCE THE LOCK: Block only if another session is already running
        if (runningSession) {
          throw new ApplicationError(
            'Operation Rejected: This learner already has an active session running on the server.'
          );
        }
      }
    }
  },
};